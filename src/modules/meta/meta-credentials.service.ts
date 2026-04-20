import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { ExchangeMetaTokenDto } from './dto/exchange-meta-token.dto';
import { UpsertMetaCredentialsDto } from './dto/upsert-meta-credentials.dto';
import { MetaCredential } from './entities/meta-credential.entity';

export type MetaConnectionStatus =
  | 'not_connected'
  | 'healthy'
  | 'attention'
  | 'reconnect_required'
  | 'error';

export type ActiveMetaCredentials = {
  metaAccessToken: string;
  metaTokenType: string | null;
  metaTokenExpiresAt: Date | null;
  facebookPageAccessToken: string | null;
  facebookPageId: string | null;
  instagramAccountId: string | null;
};

type DerivedLifecycleState = {
  connectionStatus: MetaConnectionStatus;
  daysUntilExpiry: number | null;
  nextRefreshDueAt: Date | null;
  requiresReconnect: boolean;
  requiresReconnectAt: Date | null;
};

type EnsureCredentialOptions = {
  allowRefresh: boolean;
  forceRefresh?: boolean;
  reason: string;
  throwOnReconnect?: boolean;
};

type SharedMetaStatus = {
  hasStoredCredentials: boolean;
  scope: string;
  tokenType: string | null;
  metaTokenExpiresAt: Date | null;
  daysUntilExpiry: number | null;
  hasMetaAccessToken: boolean;
  hasFacebookPageAccessToken: boolean;
  facebookPageId: string | null;
  instagramAccountId: string | null;
  connectedAt: Date | null;
  lastRefreshedAt: Date | null;
  lastRefreshAttemptAt: Date | null;
  lastRefreshSuccessAt: Date | null;
  lastRefreshErrorAt: Date | null;
  nextRefreshDueAt: Date | null;
  requiresReconnectAt: Date | null;
  lastError: string | null;
  canAutoRefresh: boolean;
  connectionStatus: MetaConnectionStatus;
  requiresReconnect: boolean;
  minimumRecommendedLifetimeDays: number;
  targetRefreshWindowDays: number;
};

@Injectable()
export class MetaCredentialsService {
  private static readonly MINIMUM_RECOMMENDED_LIFETIME_DAYS = 30;

  private static readonly REFRESH_WINDOW_DAYS = 45;

  private static readonly REFRESH_CADENCE_DAYS = 15;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(MetaCredential)
    private readonly metaCredentialRepository: Repository<MetaCredential>,
  ) {}

  async getSharedCredentialsStatus() {
    const credentials = await this.getOrCreateSharedCredentials();
    if (!credentials) {
      return this.buildEmptyStatus();
    }

    const synced = await this.persistDerivedLifecycle(credentials);
    return this.serializeCredentialStatus(synced);
  }

  async getFacebookStatus() {
    const sharedStatus = (await this.getSharedCredentialsStatus()) as SharedMetaStatus;
    return this.buildPlatformStatus(sharedStatus, 'facebook');
  }

  async getInstagramStatus() {
    const sharedStatus = (await this.getSharedCredentialsStatus()) as SharedMetaStatus;
    return this.buildPlatformStatus(sharedStatus, 'instagram');
  }

  async upsertSharedCredentials(user: User, dto: UpsertMetaCredentialsDto) {
    const credentials = await this.getOrCreateSharedCredentials(true);
    const next =
      credentials ?? this.metaCredentialRepository.create({ scope: 'shared' });

    const nextAccessToken =
      dto.accessToken !== undefined
        ? this.normalizeNullableString(dto.accessToken)
        : next.meta_access_token;

    if (dto.accessToken !== undefined) {
      next.meta_access_token = nextAccessToken;
    }
    if (dto.tokenType !== undefined) {
      next.meta_token_type = this.normalizeNullableString(dto.tokenType);
    }
    if (dto.accessTokenExpiresAt !== undefined) {
      next.meta_token_expires_at = this.normalizeOptionalDate(
        dto.accessTokenExpiresAt,
      );
    }
    if (dto.facebookPageAccessToken !== undefined) {
      next.facebook_page_access_token = this.normalizeNullableString(
        dto.facebookPageAccessToken,
      );
    }
    if (dto.facebookPageTokenExpiresAt !== undefined) {
      next.facebook_page_token_expires_at = this.normalizeOptionalDate(
        dto.facebookPageTokenExpiresAt,
      );
    }
    if (dto.facebookPageId !== undefined) {
      next.facebook_page_id = this.normalizeNullableString(dto.facebookPageId);
    }
    if (dto.instagramAccountId !== undefined) {
      next.instagram_account_id = this.normalizeNullableString(
        dto.instagramAccountId,
      );
    }

    if (dto.accessToken !== undefined) {
      next.connected_at = nextAccessToken ? new Date() : null;
      next.last_refresh_attempt_at = null;
      next.last_refresh_success_at = null;
      next.last_refreshed_at = null;
      next.last_refresh_error_at = null;
    }
    next.last_error = null;

    const saved = await this.saveWithDerivedLifecycle(next);
    return {
      saved: true,
      updatedByUserId: user.id,
      status: this.serializeCredentialStatus(saved),
    };
  }

  async refreshSharedCredentials(user: User) {
    const credentials = await this.getOrCreateSharedCredentials();
    if (!credentials?.meta_access_token) {
      throw new BadRequestException(
        'No stored Meta access token is available to refresh.',
      );
    }

    const refreshed = await this.refreshCredential(credentials, {
      force: true,
      reason: 'manual',
    });
    return {
      refreshed: true,
      updatedByUserId: user.id,
      status: this.serializeCredentialStatus(refreshed),
    };
  }

  async exchangeToken(user: User, dto: ExchangeMetaTokenDto) {
    const appId = this.getRequiredConfig('META_APP_ID');
    const appSecret = this.getRequiredConfig('META_APP_SECRET');
    const version = this.getApiVersion();

    const shortLivedToken = String(dto.shortLivedToken ?? '').trim();
    if (!shortLivedToken) {
      throw new BadRequestException('shortLivedToken is required.');
    }

    const result = await this.fetchJson<{
      access_token?: string;
      token_type?: string;
      expires_in?: number;
    }>(
      `https://graph.facebook.com/${version}/oauth/access_token?${new URLSearchParams(
        {
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: shortLivedToken,
        },
      ).toString()}`,
      { method: 'GET' },
      'Failed to exchange Meta access token. Verify the short-lived token is valid and not already expired.',
    );

    const longLivedToken = this.normalizeNullableString(result.access_token);
    if (!longLivedToken) {
      throw new BadRequestException(
        'Meta did not return a long-lived access token.',
      );
    }

    const existing = await this.getOrCreateSharedCredentials(true);
    const next =
      existing ?? this.metaCredentialRepository.create({ scope: 'shared' });
    const refreshedAt = new Date();

    next.meta_access_token = longLivedToken;
    next.meta_token_type =
      this.normalizeNullableString(result.token_type) ?? next.meta_token_type;
    if (Number.isFinite(result.expires_in)) {
      next.meta_token_expires_at = new Date(
        Date.now() + Number(result.expires_in) * 1000,
      );
    }
    next.connected_at = refreshedAt;
    next.last_refresh_attempt_at = refreshedAt;
    next.last_refresh_success_at = refreshedAt;
    next.last_refreshed_at = refreshedAt;
    next.last_refresh_error_at = null;
    next.last_error = null;

    const pageId =
      this.normalizeNullableString(next.facebook_page_id) ??
      this.getOptionalConfig('META_FACEBOOK_PAGE_ID');
    if (pageId) {
      try {
        next.facebook_page_access_token =
          await this.resolveFacebookPageAccessToken({
            pageId,
            userAccessToken: longLivedToken,
          });
      } catch (error: unknown) {
        next.last_error = this.getErrorMessage(error);
        next.last_refresh_error_at = new Date();
      }
    }

    const saved = await this.saveWithDerivedLifecycle(next);
    return {
      exchanged: true,
      updatedByUserId: user.id,
      status: this.serializeCredentialStatus(saved),
    };
  }

  async getActiveMetaCredentials(): Promise<ActiveMetaCredentials> {
    const credentials = await this.getOrCreateSharedCredentials();
    if (!credentials?.meta_access_token) {
      throw new BadRequestException(
        'Missing Meta credentials. Configure the shared Meta connection first.',
      );
    }

    const prepared = await this.ensureCredentialReady(credentials, {
      allowRefresh: this.canAutoRefresh(),
      reason: 'upload',
    });
    const metaAccessToken = this.normalizeNullableString(
      prepared.meta_access_token,
    );
    if (!metaAccessToken) {
      throw new BadRequestException(
        'Missing Meta credentials. Configure the shared Meta connection first.',
      );
    }

    const facebookPageId =
      this.normalizeNullableString(prepared.facebook_page_id) ??
      this.getOptionalConfig('META_FACEBOOK_PAGE_ID');
    const instagramAccountId =
      this.normalizeNullableString(prepared.instagram_account_id) ??
      this.getOptionalConfig('META_INSTAGRAM_ACCOUNT_ID');

    let facebookPageAccessToken = this.normalizeNullableString(
      prepared.facebook_page_access_token,
    );

    if (facebookPageId && !facebookPageAccessToken) {
      try {
        facebookPageAccessToken = await this.resolveFacebookPageAccessToken({
          pageId: facebookPageId,
          userAccessToken: metaAccessToken,
        });
        prepared.facebook_page_access_token = facebookPageAccessToken;
        prepared.last_error = null;
        prepared.last_refresh_error_at = null;
        await this.saveWithDerivedLifecycle(prepared);
      } catch (error: unknown) {
        prepared.last_error = this.getErrorMessage(error);
        prepared.last_refresh_error_at = new Date();
        await this.saveWithDerivedLifecycle(prepared);
        throw error;
      }
    }

    return {
      metaAccessToken,
      metaTokenType: prepared.meta_token_type,
      metaTokenExpiresAt: prepared.meta_token_expires_at,
      facebookPageAccessToken,
      facebookPageId,
      instagramAccountId,
    };
  }

  async runScheduledMaintenance(reason = 'scheduled') {
    const credentials = await this.getOrCreateSharedCredentials();
    if (!credentials) {
      return null;
    }

    const prepared = await this.ensureCredentialReady(credentials, {
      allowRefresh: this.canAutoRefresh(),
      reason,
      throwOnReconnect: false,
    });
    return this.serializeCredentialStatus(prepared);
  }

  private async ensureCredentialReady(
    credentials: MetaCredential,
    options: EnsureCredentialOptions,
  ): Promise<MetaCredential> {
    let current = await this.persistDerivedLifecycle(credentials);

    if (
      current.meta_access_token &&
      (options.forceRefresh ||
        (options.allowRefresh && this.shouldRefreshCredential(current)))
    ) {
      current = await this.refreshCredential(current, {
        force: Boolean(options.forceRefresh),
        reason: options.reason,
      });
    }

    current = await this.persistDerivedLifecycle(current);
    const derived = this.deriveLifecycleState(current);
    if (options.throwOnReconnect !== false && derived.requiresReconnect) {
      throw new BadRequestException(this.getReconnectMessage(current, derived));
    }

    return current;
  }

  private async refreshCredential(
    credentials: MetaCredential,
    options: { force: boolean; reason: string },
  ): Promise<MetaCredential> {
    if (!credentials.meta_access_token) {
      return credentials;
    }

    if (!this.canAutoRefresh()) {
      if (options.force) {
        throw new BadRequestException(
          'Automatic Meta token refresh is unavailable because META_APP_SECRET is not configured.',
        );
      }
      return credentials;
    }

    const appId = this.getRequiredConfig('META_APP_ID');
    const appSecret = this.getRequiredConfig('META_APP_SECRET');
    const version = this.getApiVersion();
    const attemptedAt = new Date();
    credentials.last_refresh_attempt_at = attemptedAt;

    try {
      const refreshed = await this.fetchJson<{
        access_token?: string;
        token_type?: string;
        expires_in?: number;
      }>(
        `https://graph.facebook.com/${version}/oauth/access_token?${new URLSearchParams(
          {
            grant_type: 'fb_exchange_token',
            client_id: appId,
            client_secret: appSecret,
            fb_exchange_token: credentials.meta_access_token,
          },
        ).toString()}`,
        { method: 'GET' },
        `Failed to refresh Meta access token during ${options.reason}.`,
      );

      const nextAccessToken = this.normalizeNullableString(
        refreshed.access_token,
      );
      if (!nextAccessToken) {
        throw new BadRequestException(
          'Meta refresh did not return an access token.',
        );
      }

      credentials.meta_access_token = nextAccessToken;
      credentials.meta_token_type =
        this.normalizeNullableString(refreshed.token_type) ??
        credentials.meta_token_type;
      credentials.meta_token_expires_at = Number.isFinite(refreshed.expires_in)
        ? new Date(Date.now() + Number(refreshed.expires_in) * 1000)
        : credentials.meta_token_expires_at;
      credentials.last_refreshed_at = attemptedAt;
      credentials.last_refresh_success_at = attemptedAt;
      credentials.last_refresh_error_at = null;
      credentials.last_error = null;

      if (credentials.facebook_page_id) {
        try {
          credentials.facebook_page_access_token =
            await this.resolveFacebookPageAccessToken({
              pageId: credentials.facebook_page_id,
              userAccessToken: nextAccessToken,
            });
        } catch (error: unknown) {
          credentials.last_error = this.getErrorMessage(error);
          credentials.last_refresh_error_at = new Date();
        }
      }

      return await this.saveWithDerivedLifecycle(credentials);
    } catch (error: unknown) {
      credentials.last_error = this.getErrorMessage(error);
      credentials.last_refresh_error_at = attemptedAt;
      const saved = await this.saveWithDerivedLifecycle(credentials);
      if (options.force) {
        throw error;
      }
      return saved;
    }
  }

  private shouldRefreshCredential(credentials: MetaCredential): boolean {
    if (!credentials.meta_access_token || !this.canAutoRefresh()) {
      return false;
    }

    const now = Date.now();
    const expiresAtMs = credentials.meta_token_expires_at?.getTime() ?? null;
    const refreshWindowMs =
      MetaCredentialsService.REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    if (expiresAtMs !== null && expiresAtMs - now <= refreshWindowMs) {
      return true;
    }

    const lastSuccessMs =
      credentials.last_refresh_success_at?.getTime() ??
      credentials.last_refreshed_at?.getTime() ??
      credentials.connected_at?.getTime() ??
      0;
    const refreshCadenceMs =
      MetaCredentialsService.REFRESH_CADENCE_DAYS * 24 * 60 * 60 * 1000;
    return now - lastSuccessMs >= refreshCadenceMs;
  }

  private deriveLifecycleState(
    credentials: MetaCredential,
  ): DerivedLifecycleState {
    const now = Date.now();
    const expiresAtMs = credentials.meta_token_expires_at?.getTime() ?? null;
    const daysUntilExpiry =
      expiresAtMs === null
        ? null
        : Math.max(0, Math.ceil((expiresAtMs - now) / (24 * 60 * 60 * 1000)));

    if (!credentials.meta_access_token) {
      return {
        connectionStatus: 'not_connected',
        daysUntilExpiry,
        nextRefreshDueAt: null,
        requiresReconnect: true,
        requiresReconnectAt: new Date(),
      };
    }

    const minimumLifetimeMs =
      MetaCredentialsService.MINIMUM_RECOMMENDED_LIFETIME_DAYS *
      24 *
      60 *
      60 *
      1000;
    const refreshWindowMs =
      MetaCredentialsService.REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const refreshCadenceMs =
      MetaCredentialsService.REFRESH_CADENCE_DAYS * 24 * 60 * 60 * 1000;

    const requiresReconnectAt =
      expiresAtMs === null ? null : new Date(expiresAtMs - minimumLifetimeMs);
    const expiryRefreshDueAt =
      expiresAtMs === null ? null : new Date(expiresAtMs - refreshWindowMs);
    const cadenceBaseMs =
      credentials.last_refresh_success_at?.getTime() ??
      credentials.last_refreshed_at?.getTime() ??
      credentials.connected_at?.getTime() ??
      now;
    const cadenceRefreshDueAt = new Date(cadenceBaseMs + refreshCadenceMs);
    const nextRefreshDueAt = this.getEarlierDate(
      expiryRefreshDueAt,
      cadenceRefreshDueAt,
    );

    const isExpired = expiresAtMs !== null && expiresAtMs <= now;
    const underMinimumLifetime =
      expiresAtMs !== null && expiresAtMs - now <= minimumLifetimeMs;

    if (isExpired) {
      return {
        connectionStatus: 'reconnect_required',
        daysUntilExpiry,
        nextRefreshDueAt,
        requiresReconnect: true,
        requiresReconnectAt: credentials.meta_token_expires_at,
      };
    }

    if (!this.canAutoRefresh() && underMinimumLifetime) {
      return {
        connectionStatus: 'reconnect_required',
        daysUntilExpiry,
        nextRefreshDueAt,
        requiresReconnect: true,
        requiresReconnectAt,
      };
    }

    if (credentials.last_error && underMinimumLifetime) {
      return {
        connectionStatus: 'reconnect_required',
        daysUntilExpiry,
        nextRefreshDueAt,
        requiresReconnect: true,
        requiresReconnectAt,
      };
    }

    if (credentials.last_error) {
      return {
        connectionStatus: 'error',
        daysUntilExpiry,
        nextRefreshDueAt,
        requiresReconnect: false,
        requiresReconnectAt,
      };
    }

    if (expiresAtMs !== null && expiresAtMs - now <= refreshWindowMs) {
      return {
        connectionStatus: 'attention',
        daysUntilExpiry,
        nextRefreshDueAt,
        requiresReconnect: false,
        requiresReconnectAt,
      };
    }

    return {
      connectionStatus: 'healthy',
      daysUntilExpiry,
      nextRefreshDueAt,
      requiresReconnect: false,
      requiresReconnectAt,
    };
  }

  private async saveWithDerivedLifecycle(
    credentials: MetaCredential,
  ): Promise<MetaCredential> {
    this.applyDerivedLifecycle(credentials);
    return await this.metaCredentialRepository.save(credentials);
  }

  private async persistDerivedLifecycle(
    credentials: MetaCredential,
  ): Promise<MetaCredential> {
    if (!this.applyDerivedLifecycle(credentials)) {
      return credentials;
    }

    return await this.metaCredentialRepository.save(credentials);
  }

  private applyDerivedLifecycle(credentials: MetaCredential): boolean {
    const derived = this.deriveLifecycleState(credentials);
    let changed = false;

    changed =
      this.assignDateField(
        credentials,
        'next_refresh_due_at',
        derived.nextRefreshDueAt,
      ) || changed;
    changed =
      this.assignDateField(
        credentials,
        'requires_reconnect_at',
        derived.requiresReconnectAt,
      ) || changed;

    if (credentials.connection_status !== derived.connectionStatus) {
      credentials.connection_status = derived.connectionStatus;
      changed = true;
    }

    return changed;
  }

  private assignDateField(
    credentials: MetaCredential,
    key: 'next_refresh_due_at' | 'requires_reconnect_at',
    nextValue: Date | null,
  ): boolean {
    const currentValue = credentials[key];
    const currentMs = currentValue?.getTime() ?? null;
    const nextMs = nextValue?.getTime() ?? null;
    if (currentMs === nextMs) {
      return false;
    }

    credentials[key] = nextValue as any;
    return true;
  }

  private serializeCredentialStatus(credentials: MetaCredential) {
    const derived = this.deriveLifecycleState(credentials);

    return {
      hasStoredCredentials: Boolean(credentials.id),
      scope: credentials.scope,
      tokenType: credentials.meta_token_type,
      metaTokenExpiresAt: credentials.meta_token_expires_at,
      daysUntilExpiry: derived.daysUntilExpiry,
      hasMetaAccessToken: Boolean(credentials.meta_access_token),
      hasFacebookPageAccessToken: Boolean(
        credentials.facebook_page_access_token,
      ),
      facebookPageId:
        credentials.facebook_page_id ??
        this.getOptionalConfig('META_FACEBOOK_PAGE_ID'),
      instagramAccountId:
        credentials.instagram_account_id ??
        this.getOptionalConfig('META_INSTAGRAM_ACCOUNT_ID'),
      connectedAt: credentials.connected_at,
      lastRefreshedAt: credentials.last_refreshed_at,
      lastRefreshAttemptAt: credentials.last_refresh_attempt_at,
      lastRefreshSuccessAt: credentials.last_refresh_success_at,
      lastRefreshErrorAt: credentials.last_refresh_error_at,
      nextRefreshDueAt: credentials.next_refresh_due_at,
      requiresReconnectAt: credentials.requires_reconnect_at,
      lastError: credentials.last_error,
      canAutoRefresh: this.canAutoRefresh(),
      connectionStatus: credentials.connection_status as MetaConnectionStatus,
      requiresReconnect: derived.requiresReconnect,
      minimumRecommendedLifetimeDays:
        MetaCredentialsService.MINIMUM_RECOMMENDED_LIFETIME_DAYS,
      targetRefreshWindowDays: MetaCredentialsService.REFRESH_WINDOW_DAYS,
    };
  }

  private buildEmptyStatus() {
    return {
      hasStoredCredentials: false,
      scope: 'shared',
      tokenType: null,
      metaTokenExpiresAt: null,
      daysUntilExpiry: null,
      hasMetaAccessToken: false,
      hasFacebookPageAccessToken: false,
      facebookPageId: this.getOptionalConfig('META_FACEBOOK_PAGE_ID'),
      instagramAccountId: this.getOptionalConfig('META_INSTAGRAM_ACCOUNT_ID'),
      connectedAt: null,
      lastRefreshedAt: null,
      lastRefreshAttemptAt: null,
      lastRefreshSuccessAt: null,
      lastRefreshErrorAt: null,
      nextRefreshDueAt: null,
      requiresReconnectAt: new Date(),
      lastError: null,
      canAutoRefresh: this.canAutoRefresh(),
      connectionStatus: 'not_connected' as MetaConnectionStatus,
      requiresReconnect: true,
      minimumRecommendedLifetimeDays:
        MetaCredentialsService.MINIMUM_RECOMMENDED_LIFETIME_DAYS,
      targetRefreshWindowDays: MetaCredentialsService.REFRESH_WINDOW_DAYS,
    };
  }

  private buildPlatformStatus(
    sharedStatus: SharedMetaStatus,
    platform: 'facebook' | 'instagram',
  ) {
    const isFacebook = platform === 'facebook';
    const platformId = isFacebook
      ? sharedStatus.facebookPageId
      : sharedStatus.instagramAccountId;
    const hasPlatformAccessToken = isFacebook
      ? sharedStatus.hasFacebookPageAccessToken
      : sharedStatus.hasMetaAccessToken;

    let connectionStatus = sharedStatus.connectionStatus;
    let lastError = sharedStatus.lastError;
    let requiresReconnect = sharedStatus.requiresReconnect;

    if (connectionStatus !== 'not_connected' && !platformId) {
      connectionStatus = 'attention';
      lastError = lastError ??
        (isFacebook
          ? 'Missing Facebook Page ID for the shared Meta connection.'
          : 'Missing Instagram account ID for the shared Meta connection.');
    }

    if (isFacebook && connectionStatus !== 'not_connected' && !hasPlatformAccessToken) {
      connectionStatus = sharedStatus.canAutoRefresh
        ? 'attention'
        : 'reconnect_required';
      requiresReconnect = !sharedStatus.canAutoRefresh;
      lastError =
        lastError ?? 'Missing Facebook Page access token for the shared Meta connection.';
    }

    const canUpload =
      sharedStatus.hasMetaAccessToken &&
      Boolean(platformId) &&
      hasPlatformAccessToken &&
      connectionStatus !== 'not_connected' &&
      connectionStatus !== 'reconnect_required' &&
      connectionStatus !== 'error';

    return {
      platform,
      connectionStatus,
      connectedAt: sharedStatus.connectedAt,
      metaTokenExpiresAt: sharedStatus.metaTokenExpiresAt,
      daysUntilExpiry: sharedStatus.daysUntilExpiry,
      canAutoRefresh: sharedStatus.canAutoRefresh,
      requiresReconnect,
      requiresReconnectAt: sharedStatus.requiresReconnectAt,
      nextRefreshDueAt: sharedStatus.nextRefreshDueAt,
      lastRefreshedAt: sharedStatus.lastRefreshedAt,
      lastError,
      canUpload,
      facebookPageId: sharedStatus.facebookPageId,
      instagramAccountId: sharedStatus.instagramAccountId,
      hasMetaAccessToken: sharedStatus.hasMetaAccessToken,
      hasFacebookPageAccessToken: sharedStatus.hasFacebookPageAccessToken,
    };
  }

  private getReconnectMessage(
    credentials: MetaCredential,
    derived: DerivedLifecycleState,
  ): string {
    if (!credentials.meta_access_token) {
      return 'Missing Meta credentials. Configure the shared Meta connection first.';
    }

    if (credentials.last_error?.trim()) {
      return `The shared Meta connection needs attention before upload: ${credentials.last_error}`;
    }

    if (!this.canAutoRefresh()) {
      return `The shared Meta connection is within ${MetaCredentialsService.MINIMUM_RECOMMENDED_LIFETIME_DAYS} days of expiry and automatic refresh is unavailable. Reconnect the shared Meta account.`;
    }

    if (derived.daysUntilExpiry === 0) {
      return 'The shared Meta access token has expired. Reconnect the shared Meta account.';
    }

    return `The shared Meta connection needs to be reconnected before it falls under the ${MetaCredentialsService.MINIMUM_RECOMMENDED_LIFETIME_DAYS}-day minimum lifetime.`;
  }

  private getEarlierDate(first: Date | null, second: Date | null): Date | null {
    if (!first) return second;
    if (!second) return first;
    return first.getTime() <= second.getTime() ? first : second;
  }

  private async getOrCreateSharedCredentials(
    skipEnvBootstrap = false,
  ): Promise<MetaCredential | null> {
    const envAccessToken =
      this.getOptionalConfig('META_ACCESS_TOKEN') ??
      this.getOptionalConfig('META_API_KEY');
    const envPageToken = this.getOptionalConfig(
      'META_FACEBOOK_PAGE_ACCESS_TOKEN',
    );
    const envFacebookPageId = this.getOptionalConfig('META_FACEBOOK_PAGE_ID');
    const envInstagramAccountId = this.getOptionalConfig(
      'META_INSTAGRAM_ACCOUNT_ID',
    );
    const envAccessTokenExpiresAt = this.normalizeOptionalDate(
      this.getOptionalConfig('META_ACCESS_TOKEN_EXPIRES_AT'),
    );
    const envPageTokenExpiresAt = this.normalizeOptionalDate(
      this.getOptionalConfig('META_FACEBOOK_PAGE_ACCESS_TOKEN_EXPIRES_AT'),
    );

    let credentials = await this.metaCredentialRepository.findOne({
      where: { scope: 'shared' },
    });
    if (credentials) {
      if (!skipEnvBootstrap) {
        let changed = false;

        if (!credentials.facebook_page_id && envFacebookPageId) {
          credentials.facebook_page_id = envFacebookPageId;
          changed = true;
        }

        if (!credentials.instagram_account_id && envInstagramAccountId) {
          credentials.instagram_account_id = envInstagramAccountId;
          changed = true;
        }

        if (!credentials.meta_access_token && envAccessToken) {
          credentials.meta_access_token = envAccessToken;
          credentials.meta_token_expires_at = envAccessTokenExpiresAt;
          credentials.connected_at = credentials.connected_at ?? new Date();
          credentials.last_error = null;
          changed = true;
        }

        if (!credentials.facebook_page_access_token && envPageToken) {
          credentials.facebook_page_access_token = envPageToken;
          credentials.facebook_page_token_expires_at = envPageTokenExpiresAt;
          changed = true;
        }

        if (changed) {
          credentials = await this.saveWithDerivedLifecycle(credentials);
        }
      }

      return credentials;
    }

    if (skipEnvBootstrap) {
      return credentials;
    }

    if (
      !envAccessToken &&
      !envPageToken &&
      !envFacebookPageId &&
      !envInstagramAccountId
    ) {
      return null;
    }

    credentials = this.metaCredentialRepository.create({
      scope: 'shared',
      meta_access_token: envAccessToken ?? null,
      meta_token_type: null,
      meta_token_expires_at: envAccessTokenExpiresAt,
      facebook_page_access_token: envPageToken ?? null,
      facebook_page_token_expires_at: envPageTokenExpiresAt,
      facebook_page_id: envFacebookPageId ?? null,
      instagram_account_id: envInstagramAccountId ?? null,
      connected_at: new Date(),
      last_refreshed_at: null,
      last_refresh_attempt_at: null,
      last_refresh_success_at: null,
      last_refresh_error_at: null,
      next_refresh_due_at: null,
      requires_reconnect_at: null,
      connection_status: 'not_connected',
      last_error: null,
    });

    return await this.saveWithDerivedLifecycle(credentials);
  }

  private async resolveFacebookPageAccessToken(params: {
    pageId: string;
    userAccessToken: string;
    configuredPageToken?: string | null;
  }): Promise<string> {
    const configuredPageToken = String(
      params.configuredPageToken ??
        this.configService.get<string>('META_FACEBOOK_PAGE_ACCESS_TOKEN') ??
        '',
    ).trim();
    if (configuredPageToken) {
      return configuredPageToken;
    }

    const { pageId, userAccessToken } = params;
    const version = this.getApiVersion();

    let accountsPayload: { data?: Array<Record<string, unknown>> } | null =
      null;
    try {
      accountsPayload = await this.fetchJson<{
        data?: Array<Record<string, unknown>>;
      }>(
        `https://graph.facebook.com/${version}/me/accounts?${new URLSearchParams(
          {
            fields: 'id,name,access_token,tasks',
            access_token: userAccessToken,
          },
        ).toString()}`,
        { method: 'GET' },
        'Failed to list Facebook Pages for the provided Meta access token.',
      );
    } catch (error: unknown) {
      const message = this.getErrorMessage(error);
      if (this.isAccountsFieldUnsupportedError(message)) {
        return userAccessToken;
      }
      throw error;
    }

    const pageRecord = Array.isArray(accountsPayload?.data)
      ? accountsPayload.data.find(
          (item) => String(item?.id ?? '').trim() === pageId,
        )
      : null;

    if (!pageRecord) {
      throw new BadRequestException(
        `The provided Meta access token cannot access Facebook Page ${pageId}. Ensure the token belongs to a user who manages this Page, or set META_FACEBOOK_PAGE_ACCESS_TOKEN directly.`,
      );
    }

    const tasks = Array.isArray(pageRecord.tasks)
      ? pageRecord.tasks
          .map((task) =>
            String(task ?? '')
              .trim()
              .toUpperCase(),
          )
          .filter(Boolean)
      : [];
    const requiredTasks = ['CREATE_CONTENT'];
    const missingTasks = requiredTasks.filter((task) => !tasks.includes(task));
    if (missingTasks.length > 0) {
      throw new BadRequestException(
        `The provided Meta access token can see Page ${pageId} but is missing required Page tasks: ${missingTasks.join(', ')}.`,
      );
    }

    const pageAccessToken = String(pageRecord.access_token ?? '').trim();
    if (!pageAccessToken) {
      throw new BadRequestException(
        'Unable to resolve a Facebook Page access token from the provided Meta access token. Set META_FACEBOOK_PAGE_ACCESS_TOKEN directly or use a user token with pages_show_list, pages_read_engagement, pages_manage_posts, and publish_video.',
      );
    }

    return pageAccessToken;
  }

  private isAccountsFieldUnsupportedError(message: string): boolean {
    return /nonexisting field \(accounts\)/i.test(message);
  }

  private getApiVersion(): string {
    const configured = String(
      this.configService.get<string>('META_API_VERSION') ?? '',
    ).trim();
    return configured || 'v25.0';
  }

  private canAutoRefresh(): boolean {
    return Boolean(this.getOptionalConfig('META_APP_SECRET'));
  }

  private getOptionalConfig(name: string): string | null {
    const value = String(this.configService.get<string>(name) ?? '').trim();
    return value || null;
  }

  private getRequiredConfig(name: string): string {
    const value = String(this.configService.get<string>(name) ?? '').trim();
    if (!value) {
      throw new BadRequestException(`Missing ${name} configuration.`);
    }
    return value;
  }

  private async fetchJson<T>(
    url: string,
    init: RequestInit,
    fallbackMessage: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, init as any);
    } catch (err: any) {
      throw new BadRequestException(
        `${fallbackMessage} ${err?.message || 'Request failed.'}`,
      );
    }

    const raw = await response.text();
    const parsed = raw ? this.safeJsonParse(raw) : null;
    if (!response.ok) {
      throw new BadRequestException(
        this.extractMetaError(parsed) || fallbackMessage,
      );
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new InternalServerErrorException(
        `${fallbackMessage} Meta returned an unexpected response payload.`,
      );
    }

    return parsed as T;
  }

  private safeJsonParse(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private extractMetaError(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const record = payload as Record<string, any>;
    const topLevelError = record.error;
    if (topLevelError && typeof topLevelError === 'object') {
      const message = String(topLevelError.message ?? '').trim();
      if (message) {
        if (/no permission to publish the video/i.test(message)) {
          return `${message}. Facebook Page video publishing requires a Page access token and a user with pages_show_list, pages_read_engagement, pages_manage_posts, publish_video, and the CREATE_CONTENT task on the target Page.`;
        }
        return message;
      }
    }

    const nestedMessage = String(record.message ?? '').trim();
    if (nestedMessage) return nestedMessage;

    return null;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      if (typeof response === 'string' && response.trim()) {
        return response;
      }
      if (response && typeof response === 'object') {
        const message = (response as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim()) {
          return message;
        }
        if (Array.isArray(message)) {
          const firstMessage = message.find(
            (item): item is string =>
              typeof item === 'string' && item.trim().length > 0,
          );
          if (firstMessage) return firstMessage;
        }
      }
      return error.message;
    }

    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return 'Unexpected Meta credential failure.';
  }

  private normalizeNullableString(value: unknown): string | null {
    const normalized = String(value ?? '').trim();
    return normalized || null;
  }

  private normalizeOptionalDate(value: unknown): Date | null {
    const normalized = String(value ?? '').trim();
    if (!normalized) return null;
    const timestamp = Date.parse(normalized);
    if (!Number.isFinite(timestamp)) {
      throw new BadRequestException(`Invalid date value: ${normalized}`);
    }
    return new Date(timestamp);
  }
}
