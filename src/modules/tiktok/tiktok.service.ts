import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Readable } from 'stream';
import { Repository } from 'typeorm';
import { ScriptsService } from '../scripts/scripts.service';
import { User } from '../users/entities/user.entity';
import { TiktokUploadDto } from './dto/tiktok-upload.dto';

const TIKTOK_AUTH_BASE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_OPEN_API_BASE_URL = 'https://open.tiktokapis.com';
const TIKTOK_SCOPES = ['user.info.basic', 'video.publish'];

type TiktokCreatorInfo = {
  creator_avatar_url?: string;
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
};

type TiktokApiEnvelope<T> = {
  data?: T;
  error?: {
    code?: string;
    message?: string;
    log_id?: string;
  };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = (hostname || '').toLowerCase();
  if (!host) return true;

  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (host.endsWith('.local')) return true;

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
    if (a === 169 && b === 254) return true;
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

  if (parsed.protocol !== 'https:') {
    throw new BadRequestException('videoUrl must use https');
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
    throw new BadRequestException('Missing TIKTOK_REDIRECT_URI');
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  return `https://${trimmed.replace(/^\/\/+/, '')}`;
}

function toBase64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createCodeVerifier(): string {
  return toBase64Url(randomBytes(64));
}

function createCodeChallenge(codeVerifier: string): string {
  return toBase64Url(createHash('sha256').update(codeVerifier).digest());
}

async function responseBodyToNodeReadable(
  res: Response,
): Promise<NodeJS.ReadableStream> {
  const body: any = (res as any).body;
  if (!body) {
    throw new BadRequestException('TikTok pull proxy received an empty body');
  }

  if (typeof body.pipe === 'function') {
    return body as NodeJS.ReadableStream;
  }

  const fromWeb = (Readable as any).fromWeb;
  if (typeof fromWeb === 'function') {
    return fromWeb(body);
  }

  const arrayBuffer = await (res as any).arrayBuffer();
  return Readable.from(Buffer.from(arrayBuffer));
}

@Injectable()
export class TiktokService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly scriptsService: ScriptsService,
  ) {}

  private getClientKey(): string {
    const clientKey = this.configService.get<string>('TIKTOK_CLIENT_KEY');
    if (!clientKey) {
      throw new BadRequestException('Missing TIKTOK_CLIENT_KEY');
    }
    return clientKey;
  }

  private getClientSecret(): string {
    const clientSecret = this.configService.get<string>('TIKTOK_CLIENT_SECRET');
    if (!clientSecret) {
      throw new BadRequestException('Missing TIKTOK_CLIENT_SECRET');
    }
    return clientSecret;
  }

  private getRedirectUri(redirectUriOverride?: string): string {
    return normalizeRedirectUri(
      redirectUriOverride ?? this.configService.get<string>('TIKTOK_REDIRECT_URI'),
    );
  }

  private getPublicBaseUrl(): string {
    const assetBaseUrl = String(
      this.configService.get<string>('REMOTION_ASSET_BASE_URL') ?? '',
    ).trim();
    if (assetBaseUrl) {
      return assetBaseUrl.replace(/\/+$/, '');
    }

    const redirectUri = this.getRedirectUri();
    try {
      return new URL(redirectUri).origin;
    } catch {
      throw new BadRequestException(
        'Unable to determine a public backend base URL for TikTok pull-from-url.',
      );
    }
  }

  private getPullProxySignature(sourceUrl: string, expiresAt: string): string {
    return createHmac('sha256', this.getClientSecret())
      .update(`${sourceUrl}|${expiresAt}`)
      .digest('hex');
  }

  private buildSignedPullProxyUrl(sourceUrl: string): string {
    const expiresAt = String(Date.now() + 65 * 60 * 1000);
    const signature = this.getPullProxySignature(sourceUrl, expiresAt);
    const params = new URLSearchParams({
      source: sourceUrl,
      expires: expiresAt,
      sig: signature,
    });
    return `${this.getPublicBaseUrl()}/tiktok/pull?${params.toString()}`;
  }

  private resolvePullFromUrl(videoUrl: string): string {
    assertVideoUrlIsPubliclyReachable(videoUrl);
    return this.buildSignedPullProxyUrl(videoUrl);
  }

  async proxyPullSource(params: {
    sourceUrl?: string;
    expires?: string;
    signature?: string;
  }): Promise<{
    upstream: Response;
  }> {
    const sourceUrl = String(params.sourceUrl ?? '').trim();
    const expires = String(params.expires ?? '').trim();
    const signature = String(params.signature ?? '').trim();

    if (!sourceUrl || !expires || !signature) {
      throw new BadRequestException('Missing TikTok pull proxy parameters.');
    }

    const expiresAt = Number(expires);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new BadRequestException('TikTok pull proxy link expired. Start the upload again.');
    }

    const expectedSignature = this.getPullProxySignature(sourceUrl, expires);
    const signatureMatches =
      expectedSignature.length === signature.length &&
      timingSafeEqual(
        Buffer.from(expectedSignature, 'utf8'),
        Buffer.from(signature, 'utf8'),
      );

    if (!signatureMatches) {
      throw new BadRequestException('Invalid TikTok pull proxy signature.');
    }

    assertVideoUrlIsPubliclyReachable(sourceUrl);

    let upstream: Response;
    try {
      upstream = await fetch(sourceUrl, { redirect: 'follow' } as any);
    } catch (error: any) {
      const details = error?.cause?.message || error?.message || 'fetch failed';
      throw new BadRequestException(
        `Unable to fetch source video for TikTok pull proxy. Details: ${details}`,
      );
    }

    if (!upstream.ok) {
      throw new BadRequestException(
        `TikTok pull proxy could not fetch source video (status ${upstream.status}).`,
      );
    }

    return { upstream };
  }

  private async exchangeToken(params: URLSearchParams): Promise<{
    access_token: string;
    expires_in: number;
    refresh_token: string;
    refresh_expires_in: number;
    open_id?: string;
    scope?: string;
    token_type?: string;
  }> {
    const response = await fetch(`${TIKTOK_OPEN_API_BASE_URL}/v2/oauth/token/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      body: params.toString(),
    });

    const data = (await response.json().catch(() => null)) as
      | Record<string, any>
      | null;

    if (!response.ok || !data?.access_token) {
      throw new BadRequestException(
        String(data?.error_description || data?.message || 'TikTok token exchange failed.'),
      );
    }

    return data as {
      access_token: string;
      expires_in: number;
      refresh_token: string;
      refresh_expires_in: number;
      open_id?: string;
      scope?: string;
      token_type?: string;
    };
  }

  private async requestTikTok<T>(params: {
    accessToken: string;
    path: string;
    body?: Record<string, unknown>;
  }): Promise<T> {
    const response = await fetch(`${TIKTOK_OPEN_API_BASE_URL}${params.path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: params.body ? JSON.stringify(params.body) : undefined,
    });

    const data = (await response.json().catch(() => null)) as TiktokApiEnvelope<T> | null;
    const errorCode = data?.error?.code ?? (response.ok ? 'ok' : 'request_failed');
    const errorMessage = data?.error?.message || 'TikTok request failed.';

    if (!response.ok || errorCode !== 'ok') {
      throw new BadRequestException(errorMessage);
    }

    if (!data?.data) {
      throw new InternalServerErrorException('TikTok returned an empty response.');
    }

    return data.data;
  }

  private async refreshAccessToken(user: User): Promise<User> {
    if (!user.tiktok_refresh_token) {
      throw new BadRequestException('TikTok is not connected for this account. Connect first.');
    }

    if (
      user.tiktok_refresh_token_expiry &&
      user.tiktok_refresh_token_expiry.getTime() <= Date.now() + 60_000
    ) {
      throw new BadRequestException('TikTok connection expired. Reconnect TikTok and try again.');
    }

    const tokenData = await this.exchangeToken(
      new URLSearchParams({
        client_key: this.getClientKey(),
        client_secret: this.getClientSecret(),
        grant_type: 'refresh_token',
        refresh_token: user.tiktok_refresh_token,
      }),
    );

    user.tiktok_access_token = tokenData.access_token;
    user.tiktok_refresh_token = tokenData.refresh_token || user.tiktok_refresh_token;
    user.tiktok_token_expiry = new Date(Date.now() + Number(tokenData.expires_in || 0) * 1000);
    user.tiktok_refresh_token_expiry = new Date(
      Date.now() + Number(tokenData.refresh_expires_in || 0) * 1000,
    );
    user.tiktok_open_id = tokenData.open_id ?? user.tiktok_open_id;
    user.tiktok_scope = tokenData.scope ?? user.tiktok_scope;
    user.tiktok_connected_at = user.tiktok_connected_at ?? new Date();

    return this.usersRepository.save(user);
  }

  private async getValidAccessToken(user: User): Promise<{ accessToken: string; user: User }> {
    if (!user.tiktok_access_token && !user.tiktok_refresh_token) {
      throw new BadRequestException('TikTok is not connected for this account. Connect first.');
    }

    if (
      user.tiktok_access_token &&
      user.tiktok_token_expiry &&
      user.tiktok_token_expiry.getTime() > Date.now() + 60_000
    ) {
      return { accessToken: user.tiktok_access_token, user };
    }

    const refreshedUser = await this.refreshAccessToken(user);
    if (!refreshedUser.tiktok_access_token) {
      throw new BadRequestException('Unable to refresh TikTok access token. Reconnect TikTok.');
    }

    return { accessToken: refreshedUser.tiktok_access_token, user: refreshedUser };
  }

  private async fetchCreatorInfoWithAccessToken(accessToken: string): Promise<TiktokCreatorInfo> {
    return this.requestTikTok<TiktokCreatorInfo>({
      accessToken,
      path: '/v2/post/publish/creator_info/query/',
      body: {},
    });
  }

  async getAuthUrl(user: User, redirectUriOverride?: string): Promise<string> {
    const state = toBase64Url(randomBytes(24));
    const codeVerifier = createCodeVerifier();
    const codeChallenge = createCodeChallenge(codeVerifier);

    user.tiktok_oauth_state = state;
    user.tiktok_code_verifier = codeVerifier;
    user.tiktok_oauth_started_at = new Date();
    await this.usersRepository.save(user);

    const searchParams = new URLSearchParams({
      client_key: this.getClientKey(),
      scope: TIKTOK_SCOPES.join(','),
      response_type: 'code',
      redirect_uri: this.getRedirectUri(redirectUriOverride),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return `${TIKTOK_AUTH_BASE_URL}?${searchParams.toString()}`;
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

    const user = await this.usersRepository.findOne({
      where: { tiktok_oauth_state: state },
    });
    if (!user || !user.tiktok_code_verifier) {
      throw new BadRequestException('Invalid TikTok OAuth state. Start the connection again.');
    }

    const tokenData = await this.exchangeToken(
      new URLSearchParams({
        client_key: this.getClientKey(),
        client_secret: this.getClientSecret(),
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.getRedirectUri(redirectUriOverride),
        code_verifier: user.tiktok_code_verifier,
      }),
    );

    user.tiktok_access_token = tokenData.access_token;
    user.tiktok_refresh_token = tokenData.refresh_token;
    user.tiktok_token_expiry = new Date(Date.now() + Number(tokenData.expires_in || 0) * 1000);
    user.tiktok_refresh_token_expiry = new Date(
      Date.now() + Number(tokenData.refresh_expires_in || 0) * 1000,
    );
    user.tiktok_open_id = tokenData.open_id ?? null;
    user.tiktok_scope = tokenData.scope ?? null;
    user.tiktok_connected_at = new Date();
    user.tiktok_oauth_state = null;
    user.tiktok_code_verifier = null;
    user.tiktok_oauth_started_at = null;

    await this.usersRepository.save(user);
  }

  async getCreatorInfo(user: User): Promise<TiktokCreatorInfo> {
    const { accessToken } = await this.getValidAccessToken(user);
    return this.fetchCreatorInfoWithAccessToken(accessToken);
  }

  private async pollPublishResult(accessToken: string, publishId: string): Promise<{
    status: string;
    fail_reason?: string;
    publicPostId?: string | null;
  }> {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const data = await this.requestTikTok<Record<string, any>>({
        accessToken,
        path: '/v2/post/publish/status/fetch/',
        body: { publish_id: publishId },
      });

      const status = String(data?.status ?? '').trim();
      const idsRaw =
        data?.publicaly_available_post_id ??
        data?.publicly_available_post_id ??
        data?.publicly_available_post_ids ??
        [];
      const publicIds = Array.isArray(idsRaw)
        ? idsRaw.map((value) => String(value ?? '').trim()).filter(Boolean)
        : [];

      if (status === 'PUBLISH_COMPLETE') {
        return {
          status,
          publicPostId: publicIds[0] ?? null,
        };
      }

      if (status === 'FAILED') {
        return {
          status,
          fail_reason: String(data?.fail_reason ?? 'TikTok processing failed.'),
          publicPostId: publicIds[0] ?? null,
        };
      }

      await sleep(5000);
    }

    return {
      status: 'PROCESSING_UPLOAD',
      publicPostId: null,
    };
  }

  private async persistScriptUrl(params: {
    user: User;
    dto: TiktokUploadDto;
    tiktokUrl: string | null;
  }): Promise<string | null> {
    const { user, dto, tiktokUrl } = params;
    const scriptIdRaw = String(dto.scriptId ?? '').trim();
    const scriptTextRaw = String(dto.scriptText ?? '').trim();

    if (scriptIdRaw) {
      await this.scriptsService.update(scriptIdRaw, user.id, {
        tiktok_url: tiktokUrl,
      } as any);
      return scriptIdRaw;
    }

    if (scriptTextRaw) {
      const saved = await this.scriptsService.create(user.id, {
        script: scriptTextRaw,
        tiktok_url: tiktokUrl,
      } as any);
      return saved?.id ?? null;
    }

    return null;
  }

  async uploadVideo(
    user: User,
    dto: TiktokUploadDto,
  ): Promise<{
    publishId: string;
    status: string;
    tiktokUrl: string | null;
    scriptId: string | null;
    creatorUsername: string | null;
    warning?: string;
  }> {
    const { accessToken } = await this.getValidAccessToken(user);
    const creatorInfo = await this.fetchCreatorInfoWithAccessToken(accessToken);

    if (!dto.consentConfirmed) {
      throw new BadRequestException(
        'You must confirm TikTok\'s publishing declaration before posting.',
      );
    }

    if (!dto.privacyLevel) {
      throw new BadRequestException('Select a TikTok privacy setting before posting.');
    }

    if (
      (dto.brandContentToggle || dto.brandOrganicToggle) &&
      dto.privacyLevel === 'SELF_ONLY'
    ) {
      throw new BadRequestException(
        'Commercial content cannot be posted with Only me visibility.',
      );
    }

    const privacyOptions = Array.isArray(creatorInfo.privacy_level_options)
      ? creatorInfo.privacy_level_options.map((value) => String(value || '').trim())
      : [];
    if (!privacyOptions.includes(dto.privacyLevel)) {
      throw new BadRequestException('Selected TikTok privacy setting is no longer available for this account.');
    }

    const caption = String(dto.caption ?? '').trim();
    if (caption.length > 2200) {
      throw new BadRequestException('TikTok caption must be 2200 characters or fewer.');
    }

    const pullFromUrl = this.resolvePullFromUrl(dto.videoUrl);

    const initData = await this.requestTikTok<{ publish_id: string }>({
      accessToken,
      path: '/v2/post/publish/video/init/',
      body: {
        post_info: {
          ...(caption ? { title: caption } : {}),
          privacy_level: dto.privacyLevel,
          disable_comment: creatorInfo.comment_disabled ? true : Boolean(dto.disableComment),
          disable_duet: creatorInfo.duet_disabled ? true : Boolean(dto.disableDuet),
          disable_stitch: creatorInfo.stitch_disabled ? true : Boolean(dto.disableStitch),
          brand_content_toggle: Boolean(dto.brandContentToggle),
          brand_organic_toggle: Boolean(dto.brandOrganicToggle),
          is_aigc: true,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: pullFromUrl,
        },
      },
    });

    if (!initData.publish_id) {
      throw new InternalServerErrorException('TikTok did not return a publish id.');
    }

    const publishResult = await this.pollPublishResult(accessToken, initData.publish_id);

    if (publishResult.status === 'FAILED') {
      throw new BadRequestException(
        publishResult.fail_reason || 'TikTok failed to publish this video.',
      );
    }

    const creatorUsername = String(creatorInfo.creator_username ?? '').trim() || null;
    const tiktokUrl =
      creatorUsername && publishResult.publicPostId
        ? `https://www.tiktok.com/@${creatorUsername}/video/${publishResult.publicPostId}`
        : null;

    const scriptId = await this.persistScriptUrl({
      user,
      dto,
      tiktokUrl,
    });

    return {
      publishId: initData.publish_id,
      status: publishResult.status,
      tiktokUrl,
      scriptId,
      creatorUsername,
      ...(tiktokUrl
        ? {}
        : {
            warning:
              'TikTok accepted the post, but a public video URL is not available yet. This is normal for private posts or content still under moderation.',
          }),
    };
  }
}