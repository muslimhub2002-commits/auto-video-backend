import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, youtube_v3 } from 'googleapis';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import type {
  UserYoutubeAccount,
  UserYoutubeAccountSection,
} from '../users/entities/social-account-storage.types';
import { SocialAccountsService } from '../social-accounts/social-accounts.service';
import { YoutubeUploadDto } from './dto/youtube-upload.dto';
import { Readable } from 'stream';
import { ScriptsService } from '../scripts/scripts.service';

const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

const YOUTUBE_ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly';
const YOUTUBE_READONLY_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

type YoutubeConnectionStatus =
  | 'not_connected'
  | 'healthy'
  | 'attention'
  | 'reconnect_required'
  | 'error';

type YoutubeMetricResult = {
  value: number | null;
  available: boolean;
  source: 'analytics' | 'videos' | 'derived' | 'unavailable';
  label?: string;
};

type YoutubeAnalyticsResponse = {
  scriptId: string;
  videoId: string;
  youtubeUrl: string;
  period: {
    startDate: string;
    endDate: string;
  };
  channel: {
    title: string | null;
  };
  video: {
    title: string | null;
    publishedAt: string | null;
    privacyStatus: string | null;
    duration: {
      iso8601: string | null;
      seconds: number | null;
      label: string | null;
    };
  };
  metrics: {
    views: YoutubeMetricResult;
    watchTimeMinutes: YoutubeMetricResult;
    averageViewDurationSeconds: YoutubeMetricResult;
    averageViewDurationLabel: YoutubeMetricResult;
    averageViewPercentage: YoutubeMetricResult;
    likes: YoutubeMetricResult;
    comments: YoutubeMetricResult;
    shares: YoutubeMetricResult;
    uniqueViewers: YoutubeMetricResult;
    engagedViews: YoutubeMetricResult;
  };
  analytics: {
    scopeGranted: boolean;
    metadataScopeGranted: boolean;
    available: boolean;
  };
  warnings: string[];
};

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

function formatSecondsAsDurationLabel(value: number | null): string | null {
  if (!Number.isFinite(value) || value === null || value < 0) {
    return null;
  }

  const totalSeconds = Math.round(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(
      seconds,
    ).padStart(2, '0')}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }

  return `${seconds}s`;
}

function parseIso8601DurationToSeconds(value?: string | null): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const match = raw.match(
    /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i,
  );
  if (!match) {
    return null;
  }

  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  const totalSeconds =
    days * 24 * 60 * 60 + hours * 60 * 60 + minutes * 60 + seconds;

  return Number.isFinite(totalSeconds) ? totalSeconds : null;
}

function clampAnalyticsStartDate(publishedAt?: string | null): string {
  const now = new Date();
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const lastThirtyDaysUtc = new Date(todayUtc.getTime() - 29 * 24 * 60 * 60 * 1000);

  const publishedDate = String(publishedAt ?? '').trim()
    ? new Date(publishedAt as string)
    : null;
  const startDate =
    publishedDate && Number.isFinite(publishedDate.getTime())
      ? publishedDate > lastThirtyDaysUtc
        ? publishedDate
        : lastThirtyDaysUtc
      : lastThirtyDaysUtc;

  return startDate.toISOString().slice(0, 10);
}

function getTodayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function extractYoutubeVideoId(url: string): string | null {
  const trimmed = String(url ?? '').trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.includes('youtu.be')) {
      const pathId = parsed.pathname.split('/').filter(Boolean)[0];
      return pathId ? pathId.trim() : null;
    }

    const watchId = parsed.searchParams.get('v');
    if (watchId?.trim()) {
      return watchId.trim();
    }

    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const shortsIndex = pathParts.findIndex((part) => part === 'shorts');
    if (shortsIndex >= 0 && pathParts[shortsIndex + 1]) {
      return pathParts[shortsIndex + 1].trim();
    }
  } catch {
    return null;
  }

  return null;
}

function isInsufficientScopeError(error: unknown): boolean {
  const payload = (error as any)?.response?.data?.error;
  const message = String(
    payload?.message ?? (error as any)?.message ?? '',
  ).toLowerCase();

  const details = Array.isArray(payload?.details) ? payload.details : [];
  const hasScopeDetail = details.some(
    (detail: any) =>
      String(detail?.reason ?? '').trim() === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
  );

  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  const hasPermissionReason = errors.some(
    (item: any) => String(item?.reason ?? '').trim() === 'insufficientPermissions',
  );

  return (
    hasScopeDetail ||
    hasPermissionReason ||
    message.includes('insufficient authentication scopes') ||
    message.includes('insufficient permission')
  );
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
    private readonly scriptsService: ScriptsService,
    private readonly socialAccountsService: SocialAccountsService,
  ) {}

  private createOAuthClient(
    redirectUriOverride?: string,
    credentialsOverride?: {
      clientId: string;
      clientSecret: string;
    },
  ): InstanceType<typeof google.auth.OAuth2> {
    const clientId =
      credentialsOverride?.clientId ??
      this.configService.get<string>('YOUTUBE_CLIENT_ID');
    const clientSecret =
      credentialsOverride?.clientSecret ??
      this.configService.get<string>('YOUTUBE_CLIENT_SECRET');
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

  private getManagedAccountOAuthCredentials(account: UserYoutubeAccount) {
    const clientId = String(account.credentials.clientId ?? '').trim();
    const clientSecret = String(account.credentials.clientSecret ?? '').trim();

    if (!clientId || !clientSecret) {
      throw new BadRequestException(
        `Saved YouTube account "${account.label}" is missing client credentials. Update it in Social Accounts before connecting or uploading.`,
      );
    }

    return {
      clientId,
      clientSecret,
    };
  }

  private parseManagedState(state: string): {
    userId: string;
    socialAccountId: string | null;
  } {
    const trimmedState = String(state ?? '').trim();
    const separatorIndex = trimmedState.indexOf(':');

    if (separatorIndex === -1) {
      return {
        userId: trimmedState,
        socialAccountId: null,
      };
    }

    return {
      userId: trimmedState.slice(0, separatorIndex),
      socialAccountId: trimmedState.slice(separatorIndex + 1) || null,
    };
  }

  private deriveConnectionState(user: User): {
    connectionStatus: YoutubeConnectionStatus;
    requiresReconnect: boolean;
    tokenExpiresAt: Date | null;
  } {
    const hasAccessToken = Boolean(String(user.youtube_access_token ?? '').trim());
    const hasRefreshToken = Boolean(
      String(user.youtube_refresh_token ?? '').trim(),
    );
    const tokenExpiresAt = user.youtube_token_expiry ?? null;
    const expiryMs = tokenExpiresAt?.getTime() ?? null;

    if (!hasAccessToken && !hasRefreshToken) {
      return {
        connectionStatus: 'not_connected',
        requiresReconnect: true,
        tokenExpiresAt,
      };
    }

    if (!hasRefreshToken && !hasAccessToken) {
      return {
        connectionStatus: 'reconnect_required',
        requiresReconnect: true,
        tokenExpiresAt,
      };
    }

    if (!hasRefreshToken && expiryMs !== null && expiryMs <= Date.now()) {
      return {
        connectionStatus: 'reconnect_required',
        requiresReconnect: true,
        tokenExpiresAt,
      };
    }

    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if (expiryMs !== null && expiryMs - Date.now() <= sevenDaysMs) {
      return {
        connectionStatus: 'attention',
        requiresReconnect: !hasRefreshToken,
        tokenExpiresAt,
      };
    }

    return {
      connectionStatus: 'healthy',
      requiresReconnect: false,
      tokenExpiresAt,
    };
  }

  private async getGrantedScopes(
    oauth2Client: InstanceType<typeof google.auth.OAuth2>,
    accessToken: string,
  ): Promise<string[]> {
    try {
      const tokenInfo = await oauth2Client.getTokenInfo(accessToken);
      return Array.isArray((tokenInfo as any)?.scopes)
        ? ((tokenInfo as any).scopes as string[])
            .map((scope) => String(scope ?? '').trim())
            .filter(Boolean)
        : [];
    } catch {
      return [];
    }
  }

  private hasScope(scopes: string[], expected: string): boolean {
    return scopes.includes(expected);
  }

  private buildUnavailableMetric(label?: string): YoutubeMetricResult {
    return {
      value: null,
      available: false,
      source: 'unavailable',
      ...(label ? { label } : {}),
    };
  }

  private normalizeAnalyticsRow(
    columnHeaders: Array<{ name?: string | null }> | undefined,
    rows: unknown,
  ): Record<string, number> {
    const headers = Array.isArray(columnHeaders) ? columnHeaders : [];
    const firstRow = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : [];
    const normalized: Record<string, number> = {};

    headers.forEach((header, index) => {
      const key = String(header?.name ?? '').trim();
      const rawValue = firstRow[index];
      const numericValue = Number(rawValue);

      if (key && Number.isFinite(numericValue)) {
        normalized[key] = numericValue;
      }
    });

    return normalized;
  }

  private async queryYoutubeAnalyticsMetrics(params: {
    auth: InstanceType<typeof google.auth.OAuth2>;
    videoId: string;
    startDate: string;
    endDate: string;
    metrics: string[];
  }): Promise<Record<string, number>> {
    const youtubeAnalytics = google.youtubeAnalytics({
      version: 'v2',
      auth: params.auth,
    });

    const response = await youtubeAnalytics.reports.query({
      ids: 'channel==MINE',
      startDate: params.startDate,
      endDate: params.endDate,
      metrics: params.metrics.join(','),
      dimensions: 'video',
      filters: `video==${params.videoId}`,
      maxResults: 1,
    });

    return this.normalizeAnalyticsRow(
      response.data.columnHeaders as Array<{ name?: string | null }> | undefined,
      response.data.rows,
    );
  }

  async getAuthUrl(
    userId: string,
    redirectUriOverride?: string,
    socialAccountId?: string | null,
  ): Promise<string> {
    const runtime = await this.socialAccountsService.getYoutubeAccountRuntimeContext(
      userId,
      socialAccountId,
    );
    const oauth2Client = runtime
      ? this.createOAuthClient(
          redirectUriOverride,
          this.getManagedAccountOAuthCredentials(runtime.account),
        )
      : this.createOAuthClient(redirectUriOverride);
    const state = runtime ? `${userId}:${runtime.account.id}` : userId;

    // access_type=offline + prompt=consent help ensure refresh_token is issued
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: YOUTUBE_SCOPES,
      state,
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

    const parsedState = this.parseManagedState(state);
    const user = await this.usersRepository.findOne({
      where: { id: parsedState.userId },
    });
    if (!user) {
      throw new BadRequestException('Invalid OAuth state (user not found)');
    }

    const runtime = parsedState.socialAccountId
      ? await this.socialAccountsService.getYoutubeAccountRuntimeContext(
          parsedState.userId,
          parsedState.socialAccountId,
        )
      : null;
    const oauth2Client = runtime
      ? this.createOAuthClient(
          redirectUriOverride,
          this.getManagedAccountOAuthCredentials(runtime.account),
        )
      : this.createOAuthClient(redirectUriOverride);
    const tokenResponse = await oauth2Client.getToken(code);

    const tokens = tokenResponse.tokens;
    if (!tokens.access_token) {
      throw new BadRequestException('OAuth did not return an access token');
    }

    if (runtime) {
      const now = new Date().toISOString();

      runtime.account.tokens.accessToken = tokens.access_token;
      runtime.account.tokens.refreshToken =
        tokens.refresh_token ?? runtime.account.tokens.refreshToken ?? null;
      runtime.account.tokens.tokenExpiry = tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : runtime.account.tokens.tokenExpiry ?? null;
      runtime.account.tokens.connectedAt = now;
      runtime.account.connectedAt = now;
      runtime.account.tokenExpiresAt = runtime.account.tokens.tokenExpiry;
      runtime.account.connectionStatus = 'healthy';
      runtime.account.lastValidatedAt = now;
      runtime.account.lastError = null;
      runtime.account.updatedAt = now;

      await this.socialAccountsService.saveYoutubeAccountRuntimeContext(
        runtime.user,
        runtime.section,
      );
      return;
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

  private async getAuthedClientForUser(params: {
    user: User;
    account?: UserYoutubeAccount | null;
    section?: UserYoutubeAccountSection | null;
  }): Promise<InstanceType<typeof google.auth.OAuth2>> {
    const { user, account, section } = params;
    const storedAccessToken = account
      ? String(account.tokens.accessToken ?? '').trim() || null
      : String(user.youtube_access_token ?? '').trim() || null;
    const refreshToken = account
      ? String(account.tokens.refreshToken ?? '').trim() || null
      : String(user.youtube_refresh_token ?? '').trim() || null;
    const tokenExpiry = account
      ? String(account.tokens.tokenExpiry ?? '').trim() || null
      : user.youtube_token_expiry?.toISOString() ?? null;

    if (!refreshToken && !storedAccessToken) {
      // Important: do NOT throw 401 here; the frontend interceptor would interpret
      // it as an expired login and force logout. This is a normal precondition.
      throw new BadRequestException(
        account
          ? `Saved YouTube account "${account.label}" is not connected. Connect it first from the upload modal.`
          : 'YouTube is not connected for this account. Connect first via /youtube/auth-url',
      );
    }

    const oauth2Client = account
      ? this.createOAuthClient(
          undefined,
          this.getManagedAccountOAuthCredentials(account),
        )
      : this.createOAuthClient();
    oauth2Client.setCredentials({
      access_token: storedAccessToken ?? undefined,
      refresh_token: refreshToken ?? undefined,
      expiry_date: tokenExpiry ? new Date(tokenExpiry).getTime() : undefined,
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
    if (account) {
      const now = new Date().toISOString();
      account.tokens.accessToken = accessToken;
      account.tokens.connectedAt = account.tokens.connectedAt ?? now;
      account.connectedAt = account.connectedAt ?? now;
      account.connectionStatus = 'healthy';
      account.lastValidatedAt = now;
      account.lastError = null;
      account.updatedAt = now;

      if (section) {
        await this.socialAccountsService.saveYoutubeAccountRuntimeContext(
          user,
          section,
        );
      }
    } else {
      user.youtube_access_token = accessToken;
      // google-auth-library updates expiry_date internally; but not always accessible.
      // We keep existing expiry in DB; it’s optional for operation.
      await this.usersRepository.save(user);
    }

    return oauth2Client;
  }

  async getConnectionStatus(user: User): Promise<{
    platform: 'youtube';
    connectionStatus: YoutubeConnectionStatus;
    connectedAt: Date | null;
    tokenExpiresAt: Date | null;
    hasAccessToken: boolean;
    hasRefreshToken: boolean;
    requiresReconnect: boolean;
    canUpload: boolean;
    lastValidatedAt: Date;
    lastError: string | null;
    supportsAnalytics: boolean;
  }> {
    const hasAccessToken = Boolean(String(user.youtube_access_token ?? '').trim());
    const hasRefreshToken = Boolean(
      String(user.youtube_refresh_token ?? '').trim(),
    );
    const derived = this.deriveConnectionState(user);

    if (!hasAccessToken && !hasRefreshToken) {
      return {
        platform: 'youtube',
        connectionStatus: 'not_connected',
        connectedAt: user.youtube_connected_at ?? null,
        tokenExpiresAt: derived.tokenExpiresAt,
        hasAccessToken,
        hasRefreshToken,
        requiresReconnect: true,
        canUpload: false,
        lastValidatedAt: new Date(),
        lastError: 'YouTube is not connected for this account.',
        supportsAnalytics: false,
      };
    }

    try {
      const oauth2Client = this.createOAuthClient();
      oauth2Client.setCredentials({
        access_token: user.youtube_access_token ?? undefined,
        refresh_token: user.youtube_refresh_token ?? undefined,
        expiry_date: user.youtube_token_expiry
          ? user.youtube_token_expiry.getTime()
          : undefined,
      });

      const tokenResult = await oauth2Client.getAccessToken();
      const accessToken = tokenResult?.token;
      if (!accessToken) {
        throw new Error('Unable to obtain a valid YouTube access token.');
      }
      const grantedScopes = await this.getGrantedScopes(oauth2Client, accessToken);
      const supportsAnalytics = this.hasScope(
        grantedScopes,
        YOUTUBE_ANALYTICS_SCOPE,
      );

      if (user.youtube_access_token !== accessToken) {
        user.youtube_access_token = accessToken;
        await this.usersRepository.save(user);
      }

      return {
        platform: 'youtube',
        connectionStatus: derived.connectionStatus,
        connectedAt: user.youtube_connected_at ?? null,
        tokenExpiresAt: derived.tokenExpiresAt,
        hasAccessToken: true,
        hasRefreshToken,
        requiresReconnect: derived.requiresReconnect,
        canUpload: true,
        lastValidatedAt: new Date(),
        lastError: null,
        supportsAnalytics,
      };
    } catch (error: any) {
      const message =
        error?.response?.data?.error?.message ||
        error?.response?.data?.message ||
        error?.message ||
        'Failed to validate the YouTube connection.';

      return {
        platform: 'youtube',
        connectionStatus: hasRefreshToken ? 'attention' : 'reconnect_required',
        connectedAt: user.youtube_connected_at ?? null,
        tokenExpiresAt: derived.tokenExpiresAt,
        hasAccessToken,
        hasRefreshToken,
        requiresReconnect: !hasRefreshToken,
        canUpload: false,
        lastValidatedAt: new Date(),
        lastError: message,
        supportsAnalytics: false,
      };
    }
  }

  async getVideoAnalytics(
    user: User,
    scriptId: string,
  ): Promise<YoutubeAnalyticsResponse> {
    const script = await this.scriptsService.findOne(scriptId, user.id);
    const youtubeUrl = String((script as any)?.youtube_url ?? '').trim();
    if (!youtubeUrl) {
      throw new BadRequestException(
        'This script does not have a saved YouTube URL yet.',
      );
    }

    const videoId = extractYoutubeVideoId(youtubeUrl);
    if (!videoId) {
      throw new BadRequestException(
        'Unable to resolve a YouTube video id from the saved YouTube URL.',
      );
    }

    const oauth2Client = await this.getAuthedClientForUser({ user });
    const accessTokenResult = await oauth2Client.getAccessToken();
    const accessToken = accessTokenResult?.token;
    if (!accessToken) {
      throw new UnauthorizedException(
        'Unable to obtain YouTube access token. Reconnect YouTube.',
      );
    }

    const grantedScopes = await this.getGrantedScopes(oauth2Client, accessToken);
    const analyticsScopeGranted = this.hasScope(
      grantedScopes,
      YOUTUBE_ANALYTICS_SCOPE,
    );
    let metadataScopeGranted = this.hasScope(
      grantedScopes,
      YOUTUBE_READONLY_SCOPE,
    );
    const uploadScopeGranted = this.hasScope(grantedScopes, YOUTUBE_UPLOAD_SCOPE);

    const warnings: string[] = [];

    if (!metadataScopeGranted && uploadScopeGranted) {
      warnings.push(
        'This YouTube connection can upload videos but cannot read video metadata yet. Reconnect YouTube to grant read access and unlock richer analytics.',
      );
    }

    let videoItem: youtube_v3.Schema$Video | null = null;

    if (metadataScopeGranted) {
      const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

      try {
        const videoResponse = await youtube.videos.list({
          id: [videoId],
          part: ['snippet', 'statistics', 'contentDetails', 'status'],
        });

        videoItem = Array.isArray(videoResponse.data.items)
          ? (videoResponse.data.items[0] ?? null)
          : null;

        if (!videoItem) {
          warnings.push(
            'YouTube video metadata could not be loaded for this record. Core analytics may still appear when scope access is available.',
          );
          metadataScopeGranted = false;
        }
      } catch (error) {
        if (isInsufficientScopeError(error)) {
          metadataScopeGranted = false;
          warnings.push(
            'This YouTube connection does not currently allow video metadata reads. Reconnect YouTube to grant read access.',
          );
        } else {
          throw new BadRequestException(
            'YouTube metadata for this video could not be loaded.',
          );
        }
      }
    }

    const durationIso = String(videoItem?.contentDetails?.duration ?? '').trim() || null;
    const durationSeconds = parseIso8601DurationToSeconds(durationIso);
    const publishedAt = String(videoItem?.snippet?.publishedAt ?? '').trim() || null;
    const startDate = clampAnalyticsStartDate(publishedAt);
    const endDate = getTodayIsoDate();

    let analyticsRows: Record<string, number> = {};
    let uniqueMetrics: Record<string, number> = {};
    let engagementMetrics: Record<string, number> = {};

    if (analyticsScopeGranted) {
      try {
        analyticsRows = await this.queryYoutubeAnalyticsMetrics({
          auth: oauth2Client,
          videoId,
          startDate,
          endDate,
          metrics: [
            'views',
            'estimatedMinutesWatched',
            'averageViewDuration',
            'averageViewPercentage',
            'likes',
            'comments',
            'shares',
          ],
        });
      } catch (error: any) {
        warnings.push(
          error?.message || 'Core YouTube analytics metrics are unavailable.',
        );
      }

      try {
        uniqueMetrics = await this.queryYoutubeAnalyticsMetrics({
          auth: oauth2Client,
          videoId,
          startDate,
          endDate,
          metrics: ['uniqueViewers'],
        });
      } catch {
        warnings.push('Unique viewers are not currently available for this video.');
      }

      try {
        engagementMetrics = await this.queryYoutubeAnalyticsMetrics({
          auth: oauth2Client,
          videoId,
          startDate,
          endDate,
          metrics: ['engagedViews'],
        });
      } catch {
        warnings.push('Engaged views are not currently available for this video.');
      }
    } else {
      warnings.push(
        'The current YouTube connection does not include analytics read access yet. Reconnect YouTube to unlock full metrics.',
      );
    }

    const statistics = videoItem?.statistics;
    const analyticsAvailable = analyticsScopeGranted && Object.keys(analyticsRows).length > 0;

    const averageViewDurationSeconds =
      analyticsRows.averageViewDuration ?? null;

    return {
      scriptId,
      videoId,
      youtubeUrl,
      period: {
        startDate,
        endDate,
      },
      channel: {
        title: String(videoItem?.snippet?.channelTitle ?? '').trim() || null,
      },
      video: {
        title: String(videoItem?.snippet?.title ?? '').trim() || null,
        publishedAt,
        privacyStatus: String(videoItem?.status?.privacyStatus ?? '').trim() || null,
        duration: {
          iso8601: durationIso,
          seconds: durationSeconds,
          label: formatSecondsAsDurationLabel(durationSeconds),
        },
      },
      metrics: {
        views:
          analyticsRows.views !== undefined
            ? {
                value: analyticsRows.views,
                available: true,
                source: 'analytics',
              }
            : {
                value: Number(statistics?.viewCount ?? NaN),
                available: Number.isFinite(Number(statistics?.viewCount ?? NaN)),
                source: Number.isFinite(Number(statistics?.viewCount ?? NaN))
                  ? 'videos'
                  : 'unavailable',
              },
        watchTimeMinutes:
          analyticsRows.estimatedMinutesWatched !== undefined
            ? {
                value: analyticsRows.estimatedMinutesWatched,
                available: true,
                source: 'analytics',
              }
            : this.buildUnavailableMetric(),
        averageViewDurationSeconds:
          averageViewDurationSeconds !== null
            ? {
                value: averageViewDurationSeconds,
                available: true,
                source: 'analytics',
              }
            : this.buildUnavailableMetric(),
        averageViewDurationLabel:
          averageViewDurationSeconds !== null
            ? {
                value: averageViewDurationSeconds,
                available: true,
                source: 'derived',
                label:
                  formatSecondsAsDurationLabel(averageViewDurationSeconds) ??
                  undefined,
              }
            : this.buildUnavailableMetric(),
        averageViewPercentage:
          analyticsRows.averageViewPercentage !== undefined
            ? {
                value: analyticsRows.averageViewPercentage,
                available: true,
                source: 'analytics',
                label: `${analyticsRows.averageViewPercentage.toFixed(1)}%`,
              }
            : this.buildUnavailableMetric(),
        likes: Number.isFinite(Number(statistics?.likeCount ?? NaN))
          ? {
              value: Number(statistics?.likeCount ?? 0),
              available: true,
              source: 'videos',
            }
          : analyticsRows.likes !== undefined
            ? {
                value: analyticsRows.likes,
                available: true,
                source: 'analytics',
              }
            : this.buildUnavailableMetric(),
        comments: Number.isFinite(Number(statistics?.commentCount ?? NaN))
          ? {
              value: Number(statistics?.commentCount ?? 0),
              available: true,
              source: 'videos',
            }
          : analyticsRows.comments !== undefined
            ? {
                value: analyticsRows.comments,
                available: true,
                source: 'analytics',
              }
            : this.buildUnavailableMetric(),
        shares:
          analyticsRows.shares !== undefined
            ? {
                value: analyticsRows.shares,
                available: true,
                source: 'analytics',
              }
            : this.buildUnavailableMetric(),
        uniqueViewers:
          uniqueMetrics.uniqueViewers !== undefined
            ? {
                value: uniqueMetrics.uniqueViewers,
                available: true,
                source: 'analytics',
              }
            : this.buildUnavailableMetric(),
        engagedViews:
          engagementMetrics.engagedViews !== undefined
            ? {
                value: engagementMetrics.engagedViews,
                available: true,
                source: 'analytics',
              }
            : this.buildUnavailableMetric(),
      },
      analytics: {
        scopeGranted: analyticsScopeGranted,
        metadataScopeGranted,
        available: analyticsAvailable,
      },
      warnings,
    };
  }

  async uploadVideo(
    user: User,
    dto: YoutubeUploadDto,
  ): Promise<{ videoId: string; youtubeUrl: string; scriptId: string | null }> {
    try {
      const runtime = await this.socialAccountsService.getYoutubeAccountRuntimeContext(
        user.id,
        dto.socialAccountId,
      );
      const oauth2Client = await this.getAuthedClientForUser(
        runtime
          ? {
              user: runtime.user,
              account: runtime.account,
              section: runtime.section,
            }
          : { user },
      );
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
      const publicStatsViewable = dto.publicStatsViewable ?? true;
      const description = String(dto.description ?? '').trim();

      const response = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: `${dto.title}`,
            description,
            tags,
            categoryId,
            // English metadata + audio language
            defaultLanguage: 'en',
            defaultAudioLanguage: 'en',
          },
          status: {
            privacyStatus,
            selfDeclaredMadeForKids,
            publicStatsViewable,
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

      const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

      const scriptIdRaw = String((dto as any).scriptId ?? '').trim();
      const scriptTextRaw = String((dto as any).scriptText ?? '').trim();

      const saveBeforeUpload = dto.saveBeforeUpload;

      let persistedScriptId: string | null = null;

      if (scriptIdRaw) {
        // Update ONLY the targeted script row for this user.
        // Also persist the current script state (sentences/images + voice) if provided.
        const updatePayload: any = {
          youtube_url: youtubeUrl,
        };

        const cleanedTitle = String(dto.title ?? '').trim();
        if (cleanedTitle) {
          updatePayload.title = cleanedTitle;
        }

        const cleanedVideoUrl = String(
          saveBeforeUpload?.video_url ?? dto.videoUrl ?? '',
        ).trim();
        if (cleanedVideoUrl) {
          updatePayload.video_url = cleanedVideoUrl;
        }

        if (saveBeforeUpload?.script !== undefined) {
          updatePayload.script = saveBeforeUpload.script;
        }

        if (saveBeforeUpload?.voice_id !== undefined) {
          updatePayload.voice_id = saveBeforeUpload.voice_id;
        }

        if (saveBeforeUpload?.sentences !== undefined) {
          updatePayload.sentences = saveBeforeUpload.sentences;
        }

        await this.scriptsService.update(scriptIdRaw, user.id, updatePayload);
        persistedScriptId = scriptIdRaw;
      } else if (scriptTextRaw) {
        // Fallback: create/update ONE script row from text, then set youtube_url.
        // Provide title to avoid extra AI title generation latency.
        const cleanedTitle = String(dto.title ?? '').trim();
        const saved = await this.scriptsService.create(user.id, {
          script: saveBeforeUpload?.script ?? scriptTextRaw,
          title: cleanedTitle || undefined,
          video_url: (saveBeforeUpload?.video_url ?? dto.videoUrl) || undefined,
          voice_id: saveBeforeUpload?.voice_id,
          sentences: saveBeforeUpload?.sentences,
          youtube_url: youtubeUrl,
        } as any);
        persistedScriptId = saved?.id ?? null;
      }

      return { videoId, youtubeUrl, scriptId: persistedScriptId };
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
