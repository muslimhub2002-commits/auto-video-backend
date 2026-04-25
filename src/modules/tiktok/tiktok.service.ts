import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { ScriptsService } from '../scripts/scripts.service';
import { User } from '../users/entities/user.entity';
import type {
  UserTikTokAccount,
  UserTikTokAccountSection,
} from '../users/entities/social-account-storage.types';
import { SocialAccountsService } from '../social-accounts/social-accounts.service';
import { TiktokUploadDto } from './dto/tiktok-upload.dto';

const TIKTOK_AUTH_BASE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_OPEN_API_BASE_URL = 'https://open.tiktokapis.com';
const TIKTOK_SCOPES = ['user.info.basic', 'video.publish'];
const TIKTOK_MIN_CHUNK_SIZE_BYTES = 5_000_000;
const TIKTOK_DEFAULT_CHUNK_SIZE_BYTES = 32_000_000;
const TIKTOK_MAX_CHUNK_SIZE_BYTES = 64_000_000;
const TIKTOK_MAX_FINAL_CHUNK_SIZE_BYTES = 128_000_000;
const TIKTOK_MAX_VIDEO_SIZE_BYTES = 4 * 1024 * 1024 * 1024;
const TIKTOK_MAX_CHUNK_COUNT = 1000;

type TiktokConnectionStatus =
  | 'not_connected'
  | 'healthy'
  | 'attention'
  | 'reconnect_required'
  | 'error';

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

type TiktokUploadChunk = {
  start: number;
  end: number;
  size: number;
};

type TiktokUploadPlan = {
  chunkSize: number;
  totalChunkCount: number;
  chunks: TiktokUploadChunk[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = (hostname || '').toLowerCase();
  if (!host) return true;

  if (host === 'localhost' || host === '127.0.0.1' || host === '::1')
    return true;
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

function buildTiktokUploadPlan(videoSize: number): TiktokUploadPlan {
  if (!Number.isFinite(videoSize) || videoSize <= 0) {
    throw new BadRequestException(
      'TikTok video upload size must be greater than 0 bytes.',
    );
  }

  if (videoSize > TIKTOK_MAX_VIDEO_SIZE_BYTES) {
    throw new BadRequestException('TikTok videos must be 4 GB or smaller.');
  }

  if (videoSize < TIKTOK_MIN_CHUNK_SIZE_BYTES) {
    return {
      chunkSize: videoSize,
      totalChunkCount: 1,
      chunks: [
        {
          start: 0,
          end: videoSize - 1,
          size: videoSize,
        },
      ],
    };
  }

  if (videoSize <= TIKTOK_MAX_CHUNK_SIZE_BYTES) {
    return {
      chunkSize: videoSize,
      totalChunkCount: 1,
      chunks: [
        {
          start: 0,
          end: videoSize - 1,
          size: videoSize,
        },
      ],
    };
  }

  const chunkSize = TIKTOK_DEFAULT_CHUNK_SIZE_BYTES;
  const totalChunkCount = Math.floor(videoSize / chunkSize);
  if (totalChunkCount > TIKTOK_MAX_CHUNK_COUNT) {
    throw new BadRequestException(
      'TikTok upload requires too many chunks for this video size.',
    );
  }

  if (totalChunkCount < 2) {
    throw new BadRequestException(
      'Unable to calculate a valid TikTok upload chunk count.',
    );
  }

  if (
    chunkSize < TIKTOK_MIN_CHUNK_SIZE_BYTES ||
    chunkSize > TIKTOK_MAX_CHUNK_SIZE_BYTES
  ) {
    throw new BadRequestException(
      'Unable to calculate a valid TikTok upload chunk size.',
    );
  }

  const chunks: TiktokUploadChunk[] = [];
  let start = 0;

  for (let index = 0; index < totalChunkCount; index += 1) {
    const isFinalChunk = index === totalChunkCount - 1;
    const size = isFinalChunk ? videoSize - start : chunkSize;

    if (!isFinalChunk && size < TIKTOK_MIN_CHUNK_SIZE_BYTES) {
      throw new BadRequestException(
        'Unable to calculate a valid TikTok upload chunk size.',
      );
    }

    if (isFinalChunk && size > TIKTOK_MAX_FINAL_CHUNK_SIZE_BYTES) {
      throw new BadRequestException(
        'TikTok final upload chunk would exceed the allowed size.',
      );
    }

    const end = start + size - 1;

    chunks.push({ start, end, size });
    start = end + 1;
  }

  return {
    chunkSize,
    totalChunkCount,
    chunks,
  };
}

@Injectable()
export class TiktokService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly scriptsService: ScriptsService,
    private readonly socialAccountsService: SocialAccountsService,
  ) {}

  private getClientKey(): string {
    const clientKey = this.configService.get<string>('TIKTOK_CLIENT_KEY');
    if (!clientKey) {
      throw new BadRequestException('Missing TIKTOK_CLIENT_KEY');
    }
    return clientKey;
  }

  private getManagedClientKey(account: UserTikTokAccount): string {
    const clientKey = String(account.credentials.clientKey ?? '').trim();
    if (!clientKey) {
      throw new BadRequestException(
        `Saved TikTok account "${account.label}" is missing a client key. Update it in Social Accounts before connecting or uploading.`,
      );
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

  private getManagedClientSecret(account: UserTikTokAccount): string {
    const clientSecret = String(account.credentials.clientSecret ?? '').trim();
    if (!clientSecret) {
      throw new BadRequestException(
        `Saved TikTok account "${account.label}" is missing a client secret. Update it in Social Accounts before connecting or uploading.`,
      );
    }

    return clientSecret;
  }

  private getRedirectUri(redirectUriOverride?: string): string {
    return normalizeRedirectUri(
      redirectUriOverride ??
        this.configService.get<string>('TIKTOK_REDIRECT_URI'),
    );
  }

  private parseManagedState(state: string): {
    userId: string | null;
    socialAccountId: string | null;
    oauthState: string;
  } {
    const trimmedState = String(state ?? '').trim();
    const firstSeparator = trimmedState.indexOf(':');
    const secondSeparator =
      firstSeparator >= 0 ? trimmedState.indexOf(':', firstSeparator + 1) : -1;

    if (firstSeparator === -1 || secondSeparator === -1) {
      return {
        userId: null,
        socialAccountId: null,
        oauthState: trimmedState,
      };
    }

    return {
      userId: trimmedState.slice(0, firstSeparator) || null,
      socialAccountId:
        trimmedState.slice(firstSeparator + 1, secondSeparator) || null,
      oauthState: trimmedState.slice(secondSeparator + 1),
    };
  }

  private deriveConnectionState(user: User): {
    connectionStatus: TiktokConnectionStatus;
    requiresReconnect: boolean;
  } {
    const hasAccessToken = Boolean(String(user.tiktok_access_token ?? '').trim());
    const hasRefreshToken = Boolean(
      String(user.tiktok_refresh_token ?? '').trim(),
    );

    if (!hasAccessToken && !hasRefreshToken) {
      return {
        connectionStatus: 'not_connected',
        requiresReconnect: true,
      };
    }

    const refreshExpiryMs = user.tiktok_refresh_token_expiry?.getTime() ?? null;
    if (refreshExpiryMs !== null && refreshExpiryMs <= Date.now()) {
      return {
        connectionStatus: 'reconnect_required',
        requiresReconnect: true,
      };
    }

    const accessExpiryMs = user.tiktok_token_expiry?.getTime() ?? null;
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (accessExpiryMs !== null && accessExpiryMs - Date.now() <= oneDayMs) {
      return {
        connectionStatus: 'attention',
        requiresReconnect: false,
      };
    }

    return {
      connectionStatus: 'healthy',
      requiresReconnect: false,
    };
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
    const response = await fetch(
      `${TIKTOK_OPEN_API_BASE_URL}/v2/oauth/token/`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cache-Control': 'no-cache',
        },
        body: params.toString(),
      },
    );

    const data = (await response.json().catch(() => null)) as Record<
      string,
      any
    > | null;

    if (!response.ok || !data?.access_token) {
      throw new BadRequestException(
        String(
          data?.error_description ||
            data?.message ||
            'TikTok token exchange failed.',
        ),
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

    const data = (await response
      .json()
      .catch(() => null)) as TiktokApiEnvelope<T> | null;
    const errorCode =
      data?.error?.code ?? (response.ok ? 'ok' : 'request_failed');
    const errorMessage = data?.error?.message || 'TikTok request failed.';

    if (!response.ok || errorCode !== 'ok') {
      throw new BadRequestException(errorMessage);
    }

    if (!data?.data) {
      throw new InternalServerErrorException(
        'TikTok returned an empty response.',
      );
    }

    return data.data;
  }

  private async refreshAccessToken(params: {
    user: User;
    account?: UserTikTokAccount | null;
    section?: UserTikTokAccountSection | null;
  }): Promise<{ user: User; account?: UserTikTokAccount | null }> {
    const { user, account, section } = params;
    const refreshToken = account
      ? String(account.tokens.refreshToken ?? '').trim() || null
      : String(user.tiktok_refresh_token ?? '').trim() || null;
    const refreshTokenExpiry = account
      ? String(account.tokens.refreshTokenExpiry ?? '').trim() || null
      : user.tiktok_refresh_token_expiry?.toISOString() ?? null;

    if (!refreshToken) {
      throw new BadRequestException(
        account
          ? `Saved TikTok account "${account.label}" is not connected. Connect it first from the upload modal.`
          : 'TikTok is not connected for this account. Connect first.',
      );
    }

    if (
      refreshTokenExpiry &&
      new Date(refreshTokenExpiry).getTime() <= Date.now() + 60_000
    ) {
      throw new BadRequestException(
        account
          ? `Saved TikTok account "${account.label}" expired. Reconnect it and try again.`
          : 'TikTok connection expired. Reconnect TikTok and try again.',
      );
    }

    const tokenData = await this.exchangeToken(
      new URLSearchParams({
        client_key: account
          ? this.getManagedClientKey(account)
          : this.getClientKey(),
        client_secret: account
          ? this.getManagedClientSecret(account)
          : this.getClientSecret(),
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    );

    if (account) {
      const now = new Date().toISOString();

      account.tokens.accessToken = tokenData.access_token;
      account.tokens.refreshToken = tokenData.refresh_token || refreshToken;
      account.tokens.tokenExpiry = new Date(
        Date.now() + Number(tokenData.expires_in || 0) * 1000,
      ).toISOString();
      account.tokens.refreshTokenExpiry = new Date(
        Date.now() + Number(tokenData.refresh_expires_in || 0) * 1000,
      ).toISOString();
      account.tokens.openId = tokenData.open_id ?? account.tokens.openId ?? null;
      account.tokens.scope = tokenData.scope ?? account.tokens.scope ?? null;
      account.tokens.connectedAt = account.tokens.connectedAt ?? now;
      account.connectedAt = account.connectedAt ?? now;
      account.tokenExpiresAt = account.tokens.tokenExpiry;
      account.refreshTokenExpiresAt = account.tokens.refreshTokenExpiry;
      account.connectionStatus = 'healthy';
      account.lastValidatedAt = now;
      account.lastError = null;
      account.updatedAt = now;

      if (section) {
        await this.socialAccountsService.saveTikTokAccountRuntimeContext(
          user,
          section,
        );
      }

      return {
        user,
        account,
      };
    }

    user.tiktok_access_token = tokenData.access_token;
    user.tiktok_refresh_token =
      tokenData.refresh_token || user.tiktok_refresh_token;
    user.tiktok_token_expiry = new Date(
      Date.now() + Number(tokenData.expires_in || 0) * 1000,
    );
    user.tiktok_refresh_token_expiry = new Date(
      Date.now() + Number(tokenData.refresh_expires_in || 0) * 1000,
    );
    user.tiktok_open_id = tokenData.open_id ?? user.tiktok_open_id;
    user.tiktok_scope = tokenData.scope ?? user.tiktok_scope;
    user.tiktok_connected_at = user.tiktok_connected_at ?? new Date();

    return {
      user: await this.usersRepository.save(user),
      account: null,
    };
  }

  private async getValidAccessToken(params: {
    user: User;
    account?: UserTikTokAccount | null;
    section?: UserTikTokAccountSection | null;
  }): Promise<{
    accessToken: string;
    user: User;
    account?: UserTikTokAccount | null;
  }> {
    const { user, account, section } = params;
    const accessToken = account
      ? String(account.tokens.accessToken ?? '').trim() || null
      : String(user.tiktok_access_token ?? '').trim() || null;
    const refreshToken = account
      ? String(account.tokens.refreshToken ?? '').trim() || null
      : String(user.tiktok_refresh_token ?? '').trim() || null;
    const tokenExpiry = account
      ? String(account.tokens.tokenExpiry ?? '').trim() || null
      : user.tiktok_token_expiry?.toISOString() ?? null;

    if (!accessToken && !refreshToken) {
      throw new BadRequestException(
        account
          ? `Saved TikTok account "${account.label}" is not connected. Connect it first from the upload modal.`
          : 'TikTok is not connected for this account. Connect first.',
      );
    }

    if (
      accessToken &&
      tokenExpiry &&
      new Date(tokenExpiry).getTime() > Date.now() + 60_000
    ) {
      return { accessToken, user, account };
    }

    const refreshed = await this.refreshAccessToken({ user, account, section });
    const refreshedAccessToken = refreshed.account
      ? String(refreshed.account.tokens.accessToken ?? '').trim() || null
      : String(refreshed.user.tiktok_access_token ?? '').trim() || null;

    if (!refreshedAccessToken) {
      throw new BadRequestException(
        'Unable to refresh TikTok access token. Reconnect TikTok.',
      );
    }

    return {
      accessToken: refreshedAccessToken,
      user: refreshed.user,
      account: refreshed.account,
    };
  }

  private async fetchCreatorInfoWithAccessToken(
    accessToken: string,
  ): Promise<TiktokCreatorInfo> {
    return this.requestTikTok<TiktokCreatorInfo>({
      accessToken,
      path: '/v2/post/publish/creator_info/query/',
      body: {},
    });
  }

  async getAuthUrl(
    user: User,
    redirectUriOverride?: string,
    socialAccountId?: string | null,
  ): Promise<string> {
    const runtime = await this.socialAccountsService.getTikTokAccountRuntimeContext(
      user.id,
      socialAccountId,
    );
    const state = toBase64Url(randomBytes(24));
    const codeVerifier = createCodeVerifier();
    const codeChallenge = createCodeChallenge(codeVerifier);

    if (runtime) {
      const now = new Date().toISOString();

      runtime.account.tokens.oauthState = state;
      runtime.account.tokens.codeVerifier = codeVerifier;
      runtime.account.tokens.oauthStartedAt = now;
      runtime.account.lastError = null;
      runtime.account.updatedAt = now;

      await this.socialAccountsService.saveTikTokAccountRuntimeContext(
        runtime.user,
        runtime.section,
      );
    } else {
      user.tiktok_oauth_state = state;
      user.tiktok_code_verifier = codeVerifier;
      user.tiktok_oauth_started_at = new Date();
      await this.usersRepository.save(user);
    }

    const searchParams = new URLSearchParams({
      client_key: runtime
        ? this.getManagedClientKey(runtime.account)
        : this.getClientKey(),
      scope: TIKTOK_SCOPES.join(','),
      response_type: 'code',
      redirect_uri: this.getRedirectUri(redirectUriOverride),
      state: runtime ? `${user.id}:${runtime.account.id}:${state}` : state,
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

    const parsedState = this.parseManagedState(state);
    const runtime =
      parsedState.userId && parsedState.socialAccountId
        ? await this.socialAccountsService.getTikTokAccountRuntimeContext(
            parsedState.userId,
            parsedState.socialAccountId,
          )
        : null;

    const user = runtime
      ? runtime.user
      : await this.usersRepository.findOne({
          where: { tiktok_oauth_state: state },
        });
    const codeVerifier = runtime
      ? runtime.account.tokens.codeVerifier
      : user?.tiktok_code_verifier;
    const expectedState = runtime
      ? runtime.account.tokens.oauthState
      : user?.tiktok_oauth_state;

    if (
      !user ||
      !codeVerifier ||
      !expectedState ||
      String(expectedState).trim() !==
        String(runtime ? parsedState.oauthState : state).trim()
    ) {
      throw new BadRequestException(
        'Invalid TikTok OAuth state. Start the connection again.',
      );
    }

    const tokenData = await this.exchangeToken(
      new URLSearchParams({
        client_key: runtime
          ? this.getManagedClientKey(runtime.account)
          : this.getClientKey(),
        client_secret: runtime
          ? this.getManagedClientSecret(runtime.account)
          : this.getClientSecret(),
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.getRedirectUri(redirectUriOverride),
        code_verifier: String(codeVerifier),
      }),
    );

    if (runtime) {
      const now = new Date().toISOString();

      runtime.account.tokens.accessToken = tokenData.access_token;
      runtime.account.tokens.refreshToken = tokenData.refresh_token;
      runtime.account.tokens.tokenExpiry = new Date(
        Date.now() + Number(tokenData.expires_in || 0) * 1000,
      ).toISOString();
      runtime.account.tokens.refreshTokenExpiry = new Date(
        Date.now() + Number(tokenData.refresh_expires_in || 0) * 1000,
      ).toISOString();
      runtime.account.tokens.openId = tokenData.open_id ?? null;
      runtime.account.tokens.scope = tokenData.scope ?? null;
      runtime.account.tokens.connectedAt = now;
      runtime.account.tokens.oauthState = null;
      runtime.account.tokens.codeVerifier = null;
      runtime.account.tokens.oauthStartedAt = null;
      runtime.account.connectedAt = now;
      runtime.account.tokenExpiresAt = runtime.account.tokens.tokenExpiry;
      runtime.account.refreshTokenExpiresAt = runtime.account.tokens.refreshTokenExpiry;
      runtime.account.connectionStatus = 'healthy';
      runtime.account.lastValidatedAt = now;
      runtime.account.lastError = null;
      runtime.account.updatedAt = now;

      await this.socialAccountsService.saveTikTokAccountRuntimeContext(
        runtime.user,
        runtime.section,
      );
      return;
    }

    user.tiktok_access_token = tokenData.access_token;
    user.tiktok_refresh_token = tokenData.refresh_token;
    user.tiktok_token_expiry = new Date(
      Date.now() + Number(tokenData.expires_in || 0) * 1000,
    );
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

  async getCreatorInfo(
    user: User,
    socialAccountId?: string | null,
  ): Promise<TiktokCreatorInfo> {
    const runtime = await this.socialAccountsService.getTikTokAccountRuntimeContext(
      user.id,
      socialAccountId,
    );
    const { accessToken } = await this.getValidAccessToken(
      runtime
        ? {
            user: runtime.user,
            account: runtime.account,
            section: runtime.section,
          }
        : { user },
    );
    return this.fetchCreatorInfoWithAccessToken(accessToken);
  }

  async getConnectionStatus(user: User): Promise<{
    platform: 'tiktok';
    connectionStatus: TiktokConnectionStatus;
    connectedAt: Date | null;
    tokenExpiresAt: Date | null;
    refreshTokenExpiresAt: Date | null;
    creatorUsername: string | null;
    creatorNickname: string | null;
    privacyOptions: string[];
    requiresReconnect: boolean;
    canUpload: boolean;
    lastValidatedAt: Date;
    lastError: string | null;
  }> {
    const hasAccessToken = Boolean(String(user.tiktok_access_token ?? '').trim());
    const hasRefreshToken = Boolean(
      String(user.tiktok_refresh_token ?? '').trim(),
    );
    const derived = this.deriveConnectionState(user);

    if (!hasAccessToken && !hasRefreshToken) {
      return {
        platform: 'tiktok',
        connectionStatus: 'not_connected',
        connectedAt: user.tiktok_connected_at ?? null,
        tokenExpiresAt: user.tiktok_token_expiry ?? null,
        refreshTokenExpiresAt: user.tiktok_refresh_token_expiry ?? null,
        creatorUsername: null,
        creatorNickname: null,
        privacyOptions: [],
        requiresReconnect: true,
        canUpload: false,
        lastValidatedAt: new Date(),
        lastError: 'TikTok is not connected for this account.',
      };
    }

    try {
      const { accessToken, user: refreshedUser } = await this.getValidAccessToken({
        user,
      });
      const creatorInfo = await this.fetchCreatorInfoWithAccessToken(accessToken);

      return {
        platform: 'tiktok',
        connectionStatus: derived.connectionStatus,
        connectedAt: refreshedUser.tiktok_connected_at ?? null,
        tokenExpiresAt: refreshedUser.tiktok_token_expiry ?? null,
        refreshTokenExpiresAt:
          refreshedUser.tiktok_refresh_token_expiry ?? null,
        creatorUsername:
          String(creatorInfo.creator_username ?? '').trim() || null,
        creatorNickname:
          String(creatorInfo.creator_nickname ?? '').trim() || null,
        privacyOptions: Array.isArray(creatorInfo.privacy_level_options)
          ? creatorInfo.privacy_level_options
              .map((value) => String(value ?? '').trim())
              .filter(Boolean)
          : [],
        requiresReconnect: derived.requiresReconnect,
        canUpload: true,
        lastValidatedAt: new Date(),
        lastError: null,
      };
    } catch (error: any) {
      const message =
        error?.response?.data?.error?.message ||
        error?.response?.data?.message ||
        error?.message ||
        'Failed to validate the TikTok connection.';
      const shouldReconnect =
        derived.requiresReconnect ||
        /expired|reconnect|authorization|connect first/i.test(message);

      return {
        platform: 'tiktok',
        connectionStatus: shouldReconnect ? 'reconnect_required' : 'error',
        connectedAt: user.tiktok_connected_at ?? null,
        tokenExpiresAt: user.tiktok_token_expiry ?? null,
        refreshTokenExpiresAt: user.tiktok_refresh_token_expiry ?? null,
        creatorUsername: null,
        creatorNickname: null,
        privacyOptions: [],
        requiresReconnect: shouldReconnect,
        canUpload: false,
        lastValidatedAt: new Date(),
        lastError: message,
      };
    }
  }

  private async downloadVideo(
    videoUrl: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    assertVideoUrlIsPubliclyReachable(videoUrl);

    let response: Response;
    try {
      response = await fetch(videoUrl, { redirect: 'follow' } as any);
    } catch (error: any) {
      const details = error?.cause?.message || error?.message || 'fetch failed';
      throw new BadRequestException(
        `Unable to download video from videoUrl. Ensure it is a public https URL reachable from Vercel. Details: ${details}`,
      );
    }

    if (!response.ok) {
      throw new BadRequestException(
        `Failed to download video from videoUrl (status ${response.status})`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length) {
      throw new BadRequestException('Downloaded video is empty.');
    }

    const rawContentType = String(
      response.headers.get('content-type') || 'video/mp4',
    ).trim();
    const contentType =
      rawContentType === 'video/mp4' ||
      rawContentType === 'video/quicktime' ||
      rawContentType === 'video/webm'
        ? rawContentType
        : 'video/mp4';

    return { buffer, contentType };
  }

  private async uploadVideoBytes(
    uploadUrl: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    const uploadPlan = buildTiktokUploadPlan(buffer.length);

    for (let index = 0; index < uploadPlan.chunks.length; index += 1) {
      const chunk = uploadPlan.chunks[index];
      const chunkBuffer = buffer.subarray(chunk.start, chunk.end + 1);
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(chunk.size),
          'Content-Range': `bytes ${chunk.start}-${chunk.end}/${buffer.length}`,
        },
        body: chunkBuffer as any,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new BadRequestException(
          `TikTok upload transfer failed on chunk ${index + 1}/${uploadPlan.totalChunkCount} (${response.status}). ${text || ''}`.trim(),
        );
      }
    }
  }

  private async pollPublishResult(
    accessToken: string,
    publishId: string,
  ): Promise<{
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
    const runtime = await this.socialAccountsService.getTikTokAccountRuntimeContext(
      user.id,
      dto.socialAccountId,
    );
    const { accessToken } = await this.getValidAccessToken(
      runtime
        ? {
            user: runtime.user,
            account: runtime.account,
            section: runtime.section,
          }
        : { user },
    );
    const creatorInfo = await this.fetchCreatorInfoWithAccessToken(accessToken);

    if (!dto.consentConfirmed) {
      throw new BadRequestException(
        "You must confirm TikTok's publishing declaration before posting.",
      );
    }

    if (!dto.privacyLevel) {
      throw new BadRequestException(
        'Select a TikTok privacy setting before posting.',
      );
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
      ? creatorInfo.privacy_level_options.map((value) =>
          String(value || '').trim(),
        )
      : [];
    if (!privacyOptions.includes(dto.privacyLevel)) {
      throw new BadRequestException(
        'Selected TikTok privacy setting is no longer available for this account.',
      );
    }

    const caption = String(dto.caption ?? '').trim();
    if (caption.length > 2200) {
      throw new BadRequestException(
        'TikTok caption must be 2200 characters or fewer.',
      );
    }

    const { buffer, contentType } = await this.downloadVideo(dto.videoUrl);
    const uploadPlan = buildTiktokUploadPlan(buffer.length);
    let initData: { publish_id: string; upload_url: string };
    try {
      initData = await this.requestTikTok<{
        publish_id: string;
        upload_url: string;
      }>({
        accessToken,
        path: '/v2/post/publish/video/init/',
        body: {
          post_info: {
            ...(caption ? { title: caption } : {}),
            privacy_level: dto.privacyLevel,
            disable_comment: creatorInfo.comment_disabled
              ? true
              : Boolean(dto.disableComment),
            disable_duet: creatorInfo.duet_disabled
              ? true
              : Boolean(dto.disableDuet),
            disable_stitch: creatorInfo.stitch_disabled
              ? true
              : Boolean(dto.disableStitch),
            brand_content_toggle: Boolean(dto.brandContentToggle),
            brand_organic_toggle: Boolean(dto.brandOrganicToggle),
            is_aigc: true,
          },
          source_info: {
            source: 'FILE_UPLOAD',
            video_size: buffer.length,
            chunk_size: uploadPlan.chunkSize,
            total_chunk_count: uploadPlan.totalChunkCount,
          },
        },
      });
    } catch (error: any) {
      const message = String(error?.message ?? 'TikTok init failed');
      throw new BadRequestException(
        `${message} (videoSize=${buffer.length}, chunkSize=${uploadPlan.chunkSize}, totalChunkCount=${uploadPlan.totalChunkCount})`,
      );
    }

    if (!initData.publish_id || !initData.upload_url) {
      throw new InternalServerErrorException(
        'TikTok did not return an upload URL.',
      );
    }

    await this.uploadVideoBytes(initData.upload_url, buffer, contentType);
    const publishResult = await this.pollPublishResult(
      accessToken,
      initData.publish_id,
    );

    if (publishResult.status === 'FAILED') {
      throw new BadRequestException(
        publishResult.fail_reason || 'TikTok failed to publish this video.',
      );
    }

    const creatorUsername =
      String(creatorInfo.creator_username ?? '').trim() || null;
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
