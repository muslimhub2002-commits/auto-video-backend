import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { YoutubeUploadDto } from './dto/youtube-upload.dto';
import { Readable } from 'stream';

const YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];

function normalizeRedirectUri(value: string | undefined | null): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    throw new BadRequestException('Missing YOUTUBE_REDIRECT_URI');
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  // Allow env values like "auto-video-backend.vercel.app/youtube/oauth2callback"
  return `https://${trimmed.replace(/^\/\/+/, '')}`;
}

@Injectable()
export class YoutubeService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  private createOAuthClient(
    redirectUriOverride?: string,
  ): InstanceType<typeof google.auth.OAuth2> {
    const clientId = this.configService.get<string>('YOUTUBE_CLIENT_ID');
    const clientSecret = this.configService.get<string>('YOUTUBE_CLIENT_SECRET');
    const redirectUri = normalizeRedirectUri(
      redirectUriOverride ?? this.configService.get<string>('YOUTUBE_REDIRECT_URI'),
    );

    if (!clientId || !clientSecret) {
      throw new BadRequestException(
        'Missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET',
      );
    }

    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }

  getAuthUrl(userId: string, redirectUriOverride?: string): string {
    const oauth2Client = this.createOAuthClient(redirectUriOverride);

    // access_type=offline + prompt=consent help ensure refresh_token is issued
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: YOUTUBE_SCOPES,
      state: userId,
      include_granted_scopes: true,
    });
  }

  async handleOAuthCallback(params: {
    code?: string;
    state?: string;
    redirectUriOverride?: string;
  }): Promise<void> {
    const { code, state, redirectUriOverride } = params;

    if (!code) {
      throw new BadRequestException('Missing OAuth `code`');
    }
    if (!state) {
      throw new BadRequestException('Missing OAuth `state`');
    }

    const user = await this.usersRepository.findOne({ where: { id: state } });
    if (!user) {
      throw new BadRequestException('Invalid OAuth state (user not found)');
    }

    const oauth2Client = this.createOAuthClient(redirectUriOverride);
    const tokenResponse = await oauth2Client.getToken(code);

    const tokens = tokenResponse.tokens;
    if (!tokens.access_token) {
      throw new BadRequestException('OAuth did not return an access token');
    }

    // refresh_token can be missing if the user already granted access in the past
    // In that case, they may need to revoke access and re-consent, or use prompt=consent.
    user.youtube_access_token = tokens.access_token;
    user.youtube_refresh_token = tokens.refresh_token ?? user.youtube_refresh_token;
    user.youtube_token_expiry = tokens.expiry_date
      ? new Date(tokens.expiry_date)
      : user.youtube_token_expiry;
    user.youtube_connected_at = new Date();

    await this.usersRepository.save(user);
  }

  private async getAuthedClientForUser(
    user: User,
  ): Promise<InstanceType<typeof google.auth.OAuth2>> {
    if (!user.youtube_refresh_token && !user.youtube_access_token) {
      // Important: do NOT throw 401 here; the frontend interceptor would interpret
      // it as an expired login and force logout. This is a normal precondition.
      throw new BadRequestException(
        'YouTube is not connected for this account. Connect first via /youtube/auth-url',
      );
    }

    const oauth2Client = this.createOAuthClient();
    oauth2Client.setCredentials({
      access_token: user.youtube_access_token ?? undefined,
      refresh_token: user.youtube_refresh_token ?? undefined,
      expiry_date: user.youtube_token_expiry
        ? user.youtube_token_expiry.getTime()
        : undefined,
    });

    // Ensure we always have a valid access token
    const tokenResult = await oauth2Client.getAccessToken();
    const accessToken = tokenResult?.token;
    if (!accessToken) {
      throw new UnauthorizedException(
        'Unable to obtain YouTube access token. Reconnect YouTube.',
      );
    }

    // Persist latest access token if refreshed
    user.youtube_access_token = accessToken;
    // google-auth-library updates expiry_date internally; but not always accessible.
    // We keep existing expiry in DB; it’s optional for operation.
    await this.usersRepository.save(user);

    return oauth2Client;
  }

  async uploadVideo(user: User, dto: YoutubeUploadDto): Promise<{ videoId: string }>{
    const oauth2Client = await this.getAuthedClientForUser(user);

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    const res = await fetch(dto.videoUrl);
    if (!res.ok || !res.body) {
      throw new BadRequestException(
        `Failed to download video from videoUrl (status ${res.status})`,
      );
    }

    // Convert Web ReadableStream -> Node Readable for googleapis
    const bodyStream = Readable.fromWeb(res.body as any);

    const tags = Array.isArray(dto.tags)
      ? dto.tags.map((t) => t.trim()).filter(Boolean).slice(0, 500)
      : undefined;

    const privacyStatus = dto.privacyStatus ?? 'unlisted';

    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: dto.title,
          description: dto.description ?? '',
          tags,
          categoryId: '22',
        },
        status: {
          privacyStatus,
        },
      },
      media: {
        mimeType: 'video/mp4',
        body: bodyStream,
      },
    });

    const videoId = response.data.id;
    if (!videoId) {
      throw new BadRequestException('YouTube did not return a video id');
    }

    return { videoId };
  }
}
