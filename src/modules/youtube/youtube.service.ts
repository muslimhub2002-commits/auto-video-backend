import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { YoutubeUploadDto } from './dto/youtube-upload.dto';
import { Readable } from 'stream';
import { MessagesService } from '../messages/messages.service';

const YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = (hostname || '').toLowerCase();
  if (!host) return true;

  if (host === 'localhost' || host === '127.0.0.1' || host === '::1')
    return true;
  if (host.endsWith('.local')) return true;

  // If it's an IP, block common private ranges.
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    const c = Number(ipv4Match[3]);
    const d = Number(ipv4Match[4]);
    const inRange = (n: number) => Number.isFinite(n) && n >= 0 && n <= 255;
    if (![a, b, c, d].every(inRange)) return true;

    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true; // link-local
  }

  return false;
}

function assertVideoUrlIsPubliclyReachable(videoUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(videoUrl);
  } catch {
    throw new BadRequestException('videoUrl must be a valid absolute URL');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BadRequestException('videoUrl must use http or https');
  }

  if (isPrivateOrLocalHost(parsed.hostname)) {
    throw new BadRequestException(
      `videoUrl must be publicly reachable from the server. Local/private URLs are not accessible from Vercel. Received host: ${parsed.hostname}`,
    );
  }
}

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

async function responseBodyToNodeReadable(
  res: Response,
): Promise<NodeJS.ReadableStream> {
  const body: any = (res as any).body;
  if (!body) {
    throw new BadRequestException('Video download returned an empty body');
  }

  // If already a Node stream (some fetch implementations), use it directly.
  if (typeof body.pipe === 'function') {
    return body as NodeJS.ReadableStream;
  }

  // Prefer Readable.fromWeb when available (Node 18+).
  const fromWeb = (Readable as any).fromWeb;
  if (typeof fromWeb === 'function') {
    return fromWeb(body);
  }

  // Fallback for environments without Readable.fromWeb:
  // buffer the response and stream it. (Not ideal for huge files, but prevents 500s.)
  const arrayBuffer = await (res as any).arrayBuffer();
  return Readable.from(Buffer.from(arrayBuffer));
}

@Injectable()
export class YoutubeService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly messagesService: MessagesService,
  ) {}

  private createOAuthClient(
    redirectUriOverride?: string,
  ): InstanceType<typeof google.auth.OAuth2> {
    const clientId = this.configService.get<string>('YOUTUBE_CLIENT_ID');
    const clientSecret = this.configService.get<string>(
      'YOUTUBE_CLIENT_SECRET',
    );
    const redirectUri = normalizeRedirectUri(
      redirectUriOverride ??
        this.configService.get<string>('YOUTUBE_REDIRECT_URI'),
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
    user.youtube_refresh_token =
      tokens.refresh_token ?? user.youtube_refresh_token;
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

  async uploadVideo(
    user: User,
    dto: YoutubeUploadDto,
  ): Promise<{ videoId: string }> {
    // Optionally save the generation before uploading to YouTube
    if (
      (dto as any) &&
      (dto as any).saveBeforeUpload &&
      (dto as any).saveBeforeUpload.script
    ) {
      const save = (dto as any).saveBeforeUpload;
      await this.messagesService.saveGeneration(user.id, {
        script: save.script,
        video_url: save.video_url ?? dto.videoUrl,
        chat_id: save.chat_id,
        voice_id: save.voice_id,
        sentences: save.sentences,
      });
    }

    try {
      const oauth2Client = await this.getAuthedClientForUser(user);
      const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

      assertVideoUrlIsPubliclyReachable(dto.videoUrl);

      let res: Response;
      try {
        res = await fetch(dto.videoUrl, { redirect: 'follow' } as any);
      } catch (fetchErr: any) {
        // This is the common Vercel error: "fetch failed" when the URL is not reachable.
        const details =
          fetchErr?.cause?.message || fetchErr?.message || 'fetch failed';
        throw new BadRequestException(
          `Unable to download video from videoUrl. Ensure it is a PUBLIC https URL reachable from Vercel. Details: ${details}`,
        );
      }
      if (!res.ok) {
        throw new BadRequestException(
          `Failed to download video from videoUrl (status ${res.status})`,
        );
      }

      const bodyStream = await responseBodyToNodeReadable(res as any);

      const tags = Array.isArray(dto.tags)
        ? dto.tags
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 500)
        : undefined;

      const publishAt = dto.publishAt?.trim() || undefined;
      if (publishAt) {
        const publishAtMs = Date.parse(publishAt);
        if (!Number.isFinite(publishAtMs)) {
          throw new BadRequestException(
            'Invalid publishAt. Use ISO8601/RFC3339 like 2026-01-13T18:00:00+03:00',
          );
        }

        // YouTube scheduling requires a future publish time. We enforce a small buffer.
        const minMs = Date.now() + 2 * 60 * 1000;
        if (publishAtMs < minMs) {
          throw new BadRequestException(
            'publishAt must be at least 2 minutes in the future.',
          );
        }
      }

      // When publishAt is set, YouTube requires privacyStatus=private.
      const privacyStatus = publishAt
        ? 'private'
        : (dto.privacyStatus ?? 'public');
      const categoryId = (dto.categoryId ?? '24').trim();
      const selfDeclaredMadeForKids = !!dto.selfDeclaredMadeForKids;

      const response = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: dto.title,
            description: dto.description ?? '',
            tags,
            categoryId,
            // English metadata + audio language
            defaultLanguage: 'en',
            defaultAudioLanguage: 'en',
          },
          status: {
            privacyStatus,
            selfDeclaredMadeForKids,
            ...(publishAt ? { publishAt } : {}),
            // “Altered content” disclosure: No
            containsSyntheticMedia: false,
          },
        },
        media: {
          mimeType: 'video/mp4',
          body: bodyStream as any,
        },
      });

      const videoId = response.data.id;
      if (!videoId) {
        throw new BadRequestException('YouTube did not return a video id');
      }

      return { videoId };
    } catch (err: any) {
      // Add actionable logs for Vercel/serverless debugging.
      console.error('YouTube upload failed', {
        message: err?.message,
        name: err?.name,
        code: err?.code,
        status: err?.response?.status,
        data: err?.response?.data,
      });

      // Preserve explicit HTTP exceptions.
      if (
        err instanceof BadRequestException ||
        err instanceof UnauthorizedException
      ) {
        throw err;
      }

      const status = err?.response?.status;
      const apiMessage =
        err?.response?.data?.error?.message ||
        err?.response?.data?.message ||
        err?.message;

      if (status === 401 || status === 403) {
        throw new UnauthorizedException(
          apiMessage || 'YouTube authorization failed. Reconnect YouTube.',
        );
      }

      if (status === 400) {
        throw new BadRequestException(
          apiMessage || 'YouTube rejected the upload request.',
        );
      }

      throw new InternalServerErrorException(
        apiMessage || 'YouTube upload failed unexpectedly.',
      );
    }
  }
}
