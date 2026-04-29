import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import type {
  UserMetaAccount,
  UserMetaAccountSection,
  UserSocialAccountConnectionStatus,
  UserTikTokAccount,
  UserTikTokAccountSection,
  UserYoutubeAccount,
  UserYoutubeAccountSection,
} from '../users/entities/social-account-storage.types';
import { CreateSocialAccountDto } from './dto/create-social-account.dto';
import { UpdateSocialAccountDto } from './dto/update-social-account.dto';
import { shouldRunStartupTasks } from '../../common/runtime/runtime.utils';

export const SOCIAL_ACCOUNT_PROVIDERS = ['youtube', 'meta', 'tiktok'] as const;

export type SocialAccountProvider = (typeof SOCIAL_ACCOUNT_PROVIDERS)[number];

const EMPTY_SOCIAL_ACCOUNT_SECTION_SQL =
  "'{\"version\":1,\"defaultAccountId\":null,\"accounts\":[]}'::jsonb";

type SocialAccountFieldKey =
  | 'youtubeClientId'
  | 'youtubeClientSecret'
  | 'metaAppId'
  | 'metaAppSecret'
  | 'metaFacebookPageId'
  | 'metaInstagramAccountId'
  | 'metaInstagramPageAccessToken'
  | 'tiktokClientKey'
  | 'tiktokClientSecret';

type SocialAccountRecord =
  | UserYoutubeAccount
  | UserMetaAccount
  | UserTikTokAccount;

type SocialAccountSectionRecord = {
  version: 1;
  defaultAccountId: string | null;
  accounts: SocialAccountRecord[];
};

type SocialAccountRuntimeContext<
  TSection extends SocialAccountSectionRecord,
  TAccount extends SocialAccountRecord,
> = {
  user: User;
  section: TSection;
  account: TAccount;
};

type ProviderFieldDefinition = {
  key: SocialAccountFieldKey;
  label: string;
  secret?: boolean;
  getValue: (account: SocialAccountRecord) => string | null | undefined;
  setValue: (account: SocialAccountRecord, value: string | null) => void;
};

const PROVIDER_LABELS: Record<SocialAccountProvider, string> = {
  youtube: 'YouTube',
  meta: 'Meta',
  tiktok: 'TikTok',
};

const PROVIDER_FIELDS: Record<
  SocialAccountProvider,
  readonly ProviderFieldDefinition[]
> = {
  youtube: [
    {
      key: 'youtubeClientId',
      label: 'Client ID',
      getValue: (account) => (account as UserYoutubeAccount).credentials.clientId,
      setValue: (account, value) => {
        (account as UserYoutubeAccount).credentials.clientId = value;
      },
    },
    {
      key: 'youtubeClientSecret',
      label: 'Client Secret',
      secret: true,
      getValue: (account) => (account as UserYoutubeAccount).credentials.clientSecret,
      setValue: (account, value) => {
        (account as UserYoutubeAccount).credentials.clientSecret = value;
      },
    },
  ],
  meta: [
    {
      key: 'metaAppId',
      label: 'App ID',
      getValue: (account) => (account as UserMetaAccount).credentials.appId,
      setValue: (account, value) => {
        (account as UserMetaAccount).credentials.appId = value;
      },
    },
    {
      key: 'metaAppSecret',
      label: 'App Secret',
      secret: true,
      getValue: (account) => (account as UserMetaAccount).credentials.appSecret,
      setValue: (account, value) => {
        (account as UserMetaAccount).credentials.appSecret = value;
      },
    },
    {
      key: 'metaFacebookPageId',
      label: 'Facebook Page ID',
      getValue: (account) =>
        (account as UserMetaAccount).credentials.facebookPageId,
      setValue: (account, value) => {
        (account as UserMetaAccount).credentials.facebookPageId = value;
      },
    },
    {
      key: 'metaInstagramAccountId',
      label: 'Instagram Account ID',
      getValue: (account) =>
        (account as UserMetaAccount).credentials.instagramAccountId,
      setValue: (account, value) => {
        (account as UserMetaAccount).credentials.instagramAccountId = value;
      },
    },
    {
      key: 'metaInstagramPageAccessToken',
      label: 'Instagram Page Access Token',
      secret: true,
      getValue: (account) =>
        (account as UserMetaAccount).credentials.instagramPageAccessToken,
      setValue: (account, value) => {
        (account as UserMetaAccount).credentials.instagramPageAccessToken =
          value;
      },
    },
  ],
  tiktok: [
    {
      key: 'tiktokClientKey',
      label: 'Client Key',
      getValue: (account) => (account as UserTikTokAccount).credentials.clientKey,
      setValue: (account, value) => {
        (account as UserTikTokAccount).credentials.clientKey = value;
      },
    },
    {
      key: 'tiktokClientSecret',
      label: 'Client Secret',
      secret: true,
      getValue: (account) =>
        (account as UserTikTokAccount).credentials.clientSecret,
      setValue: (account, value) => {
        (account as UserTikTokAccount).credentials.clientSecret = value;
      },
    },
  ],
};

@Injectable()
export class SocialAccountsService implements OnModuleInit {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async onModuleInit() {
    if (!shouldRunStartupTasks()) {
      return;
    }

    await this.ensureSocialAccountSchema();
  }

  private async ensureSocialAccountSchema() {
    await this.ensureSectionColumn('youtube_accounts');
    await this.ensureSectionColumn('meta_accounts');
    await this.ensureSectionColumn('tiktok_accounts');
  }

  private async ensureSectionColumn(columnName: string) {
    await this.usersRepository.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS ${columnName} JSONB NULL`,
    );
    await this.usersRepository.query(
      `UPDATE users SET ${columnName} = COALESCE(${columnName}, ${EMPTY_SOCIAL_ACCOUNT_SECTION_SQL})`,
    );
    await this.usersRepository.query(
      `ALTER TABLE users ALTER COLUMN ${columnName} SET DEFAULT ${EMPTY_SOCIAL_ACCOUNT_SECTION_SQL}`,
    );
    await this.usersRepository.query(
      `ALTER TABLE users ALTER COLUMN ${columnName} SET NOT NULL`,
    );
  }

  async list(userId: string) {
    const user = await this.findUserOrThrow(userId);
    const providers = SOCIAL_ACCOUNT_PROVIDERS.map((provider) =>
      this.serializeProviderSection(provider, this.getSection(user, provider)),
    );

    const totalAccounts = providers.reduce(
      (total, provider) => total + provider.total,
      0,
    );
    const attentionCount = providers.reduce(
      (total, provider) =>
        total +
        provider.items.filter((item) =>
          ['attention', 'reconnect_required', 'error'].includes(
            item.connectionStatus,
          ),
        ).length,
      0,
    );

    return {
      summary: {
        totalAccounts,
        providersConfigured: providers.filter((provider) => provider.total > 0)
          .length,
        defaultsConfigured: providers.filter(
          (provider) => provider.defaultAccountId,
        ).length,
        attentionCount,
      },
      providers,
    };
  }

  async getProvider(userId: string, rawProvider: string) {
    const user = await this.findUserOrThrow(userId);
    const provider = this.normalizeProvider(rawProvider);
    return this.serializeProviderSection(provider, this.getSection(user, provider));
  }

  async getAccount(userId: string, rawProvider: string, accountId: string) {
    const user = await this.findUserOrThrow(userId);
    const provider = this.normalizeProvider(rawProvider);
    const section = this.getSection(user, provider);
    const account = this.findAccountOrThrow(section, accountId);

    return {
      provider,
      providerLabel: PROVIDER_LABELS[provider],
      account: {
        ...this.serializeAccountSummary(provider, account, section.defaultAccountId),
        fieldValues: this.serializeEditableFieldValues(provider, account),
      },
    };
  }

  async getYoutubeAccountRuntimeContext(
    userId: string,
    accountId?: string | null,
  ): Promise<SocialAccountRuntimeContext<UserYoutubeAccountSection, UserYoutubeAccount> | null> {
    const user = await this.findUserOrThrow(userId);
    const section = this.getSection(user, 'youtube') as UserYoutubeAccountSection;
    const account = this.findRequestedOrDefaultAccount(section, accountId);

    if (!account) {
      return null;
    }

    return {
      user,
      section,
      account: account as UserYoutubeAccount,
    };
  }

  async getMetaAccountRuntimeContext(
    userId: string,
    accountId?: string | null,
  ): Promise<SocialAccountRuntimeContext<UserMetaAccountSection, UserMetaAccount> | null> {
    const user = await this.findUserOrThrow(userId);
    const section = this.getSection(user, 'meta') as UserMetaAccountSection;
    const account = this.findRequestedOrDefaultAccount(section, accountId);

    if (!account) {
      return null;
    }

    return {
      user,
      section,
      account: account as UserMetaAccount,
    };
  }

  async getTikTokAccountRuntimeContext(
    userId: string,
    accountId?: string | null,
  ): Promise<SocialAccountRuntimeContext<UserTikTokAccountSection, UserTikTokAccount> | null> {
    const user = await this.findUserOrThrow(userId);
    const section = this.getSection(user, 'tiktok') as UserTikTokAccountSection;
    const account = this.findRequestedOrDefaultAccount(section, accountId);

    if (!account) {
      return null;
    }

    return {
      user,
      section,
      account: account as UserTikTokAccount,
    };
  }

  async saveYoutubeAccountRuntimeContext(
    user: User,
    section: UserYoutubeAccountSection,
  ) {
    await this.saveSection(user, 'youtube', section);
  }

  async saveMetaAccountRuntimeContext(
    user: User,
    section: UserMetaAccountSection,
  ) {
    await this.saveSection(user, 'meta', section);
  }

  async saveTikTokAccountRuntimeContext(
    user: User,
    section: UserTikTokAccountSection,
  ) {
    await this.saveSection(user, 'tiktok', section);
  }

  async create(
    userId: string,
    rawProvider: string,
    dto: CreateSocialAccountDto,
  ) {
    const user = await this.findUserOrThrow(userId);
    const provider = this.normalizeProvider(rawProvider);
    const section = this.getSection(user, provider);
    const label =
      this.normalizeOptionalString(dto.label) ??
      `${PROVIDER_LABELS[provider]} account ${section.accounts.length + 1}`;
    const account = this.createEmptyAccount(provider, label);

    this.applyFieldPatch(provider, account, dto.fields);
    this.assertConfiguredFields(provider, account);

    section.accounts = [...section.accounts, account];
    if (section.accounts.length === 1 || dto.makeDefault) {
      section.defaultAccountId = account.id;
    }

    await this.saveSection(user, provider, section);

    return {
      provider,
      providerLabel: PROVIDER_LABELS[provider],
      account: {
        ...this.serializeAccountSummary(provider, account, section.defaultAccountId),
        fieldValues: this.serializeEditableFieldValues(provider, account),
      },
    };
  }

  async update(
    userId: string,
    rawProvider: string,
    accountId: string,
    dto: UpdateSocialAccountDto,
  ) {
    const user = await this.findUserOrThrow(userId);
    const provider = this.normalizeProvider(rawProvider);
    const section = this.getSection(user, provider);
    const account = this.findAccountOrThrow(section, accountId);

    if (Object.prototype.hasOwnProperty.call(dto, 'label')) {
      const nextLabel = this.normalizeOptionalString(dto.label);
      if (!nextLabel) {
        throw new BadRequestException('Account label cannot be empty.');
      }
      account.label = nextLabel;
    }

    if (dto.fields) {
      this.applyFieldPatch(provider, account, dto.fields);
    }

    this.assertConfiguredFields(provider, account);
    account.updatedAt = new Date().toISOString();

    await this.saveSection(user, provider, section);

    return {
      provider,
      providerLabel: PROVIDER_LABELS[provider],
      account: {
        ...this.serializeAccountSummary(provider, account, section.defaultAccountId),
        fieldValues: this.serializeEditableFieldValues(provider, account),
      },
    };
  }

  async setDefault(userId: string, rawProvider: string, accountId: string) {
    const user = await this.findUserOrThrow(userId);
    const provider = this.normalizeProvider(rawProvider);
    const section = this.getSection(user, provider);
    const account = this.findAccountOrThrow(section, accountId);

    section.defaultAccountId = account.id;
    account.updatedAt = new Date().toISOString();

    await this.saveSection(user, provider, section);

    return {
      provider,
      providerLabel: PROVIDER_LABELS[provider],
      account: this.serializeAccountSummary(provider, account, section.defaultAccountId),
    };
  }

  async remove(userId: string, rawProvider: string, accountId: string) {
    const user = await this.findUserOrThrow(userId);
    const provider = this.normalizeProvider(rawProvider);
    const section = this.getSection(user, provider);
    const account = this.findAccountOrThrow(section, accountId);

    section.accounts = section.accounts.filter((item) => item.id !== account.id);
    if (section.defaultAccountId === account.id) {
      section.defaultAccountId = section.accounts[0]?.id ?? null;
    }

    await this.saveSection(user, provider, section);

    return {
      provider,
      providerLabel: PROVIDER_LABELS[provider],
      removedAccountId: account.id,
      defaultAccountId: section.defaultAccountId,
    };
  }

  private async findUserOrThrow(userId: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return user;
  }

  private normalizeProvider(rawProvider: string): SocialAccountProvider {
    const provider = String(rawProvider ?? '').trim().toLowerCase();
    if (!(SOCIAL_ACCOUNT_PROVIDERS as readonly string[]).includes(provider)) {
      throw new BadRequestException('Unsupported social account provider.');
    }

    return provider as SocialAccountProvider;
  }

  private getSection(user: User, provider: SocialAccountProvider) {
    const section =
      provider === 'youtube'
        ? user.youtube_accounts
        : provider === 'meta'
          ? user.meta_accounts
          : user.tiktok_accounts;

    return this.normalizeSection(section);
  }

  private normalizeSection(section: unknown): SocialAccountSectionRecord {
    const emptySection = {
      version: 1 as const,
      defaultAccountId: null,
      accounts: [],
    };

    if (!this.isRecord(section) || !Array.isArray(section.accounts)) {
      return emptySection;
    }

    const accounts = section.accounts.filter((account) =>
      this.isRecord(account),
    ) as SocialAccountRecord[];
    const defaultAccountId = this.normalizeOptionalString(section.defaultAccountId);
    const hasDefault =
      defaultAccountId && accounts.some((account) => account.id === defaultAccountId);

    return {
      version: 1,
      defaultAccountId: hasDefault ? defaultAccountId : accounts[0]?.id ?? null,
      accounts,
    };
  }

  private async saveSection(
    user: User,
    provider: SocialAccountProvider,
    section: SocialAccountSectionRecord,
  ) {
    if (provider === 'youtube') {
      user.youtube_accounts = section as UserYoutubeAccountSection;
    } else if (provider === 'meta') {
      user.meta_accounts = section as UserMetaAccountSection;
    } else {
      user.tiktok_accounts = section as UserTikTokAccountSection;
    }

    await this.usersRepository.save(user);
  }

  private findAccountOrThrow(
    section: SocialAccountSectionRecord,
    accountId: string,
  ) {
    const normalizedId = this.normalizeOptionalString(accountId);
    if (!normalizedId) {
      throw new NotFoundException('Social account not found.');
    }

    const account = section.accounts.find((item) => item.id === normalizedId);
    if (!account) {
      throw new NotFoundException('Social account not found.');
    }

    return account;
  }

  private findRequestedOrDefaultAccount(
    section: SocialAccountSectionRecord,
    accountId?: string | null,
  ) {
    const requestedAccountId = this.normalizeOptionalString(accountId);
    if (requestedAccountId) {
      return this.findAccountOrThrow(section, requestedAccountId);
    }

    if (section.accounts.length === 0) {
      return null;
    }

    if (section.defaultAccountId) {
      return this.findAccountOrThrow(section, section.defaultAccountId);
    }

    return section.accounts[0] ?? null;
  }

  private createEmptyAccount(provider: SocialAccountProvider, label: string) {
    const now = new Date().toISOString();
    const base = {
      id: randomUUID(),
      label,
      publicMetadata: null,
      connectionStatus: 'not_connected' as UserSocialAccountConnectionStatus,
      connectedAt: null,
      tokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      lastValidatedAt: null,
      lastRefreshAttemptAt: null,
      lastRefreshSuccessAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };

    if (provider === 'youtube') {
      return {
        ...base,
        credentials: {
          clientId: null,
          clientSecret: null,
        },
        tokens: {
          accessToken: null,
          refreshToken: null,
          tokenExpiry: null,
          connectedAt: null,
        },
      } satisfies UserYoutubeAccount;
    }

    if (provider === 'meta') {
      return {
        ...base,
        credentials: {
          appId: null,
          appSecret: null,
          facebookPageId: null,
          instagramAccountId: null,
          instagramPageAccessToken: null,
        },
        tokens: {
          metaAccessToken: null,
          tokenType: null,
          tokenExpiresAt: null,
          facebookPageAccessToken: null,
          facebookPageTokenExpiresAt: null,
          connectedAt: null,
          lastRefreshedAt: null,
          lastRefreshAttemptAt: null,
          lastRefreshSuccessAt: null,
          lastRefreshErrorAt: null,
          nextRefreshDueAt: null,
          requiresReconnectAt: null,
        },
      } satisfies UserMetaAccount;
    }

    return {
      ...base,
      credentials: {
        clientKey: null,
        clientSecret: null,
      },
      tokens: {
        accessToken: null,
        refreshToken: null,
        tokenExpiry: null,
        refreshTokenExpiry: null,
        openId: null,
        scope: null,
        connectedAt: null,
        oauthState: null,
        codeVerifier: null,
        oauthStartedAt: null,
      },
    } satisfies UserTikTokAccount;
  }

  private applyFieldPatch(
    provider: SocialAccountProvider,
    account: SocialAccountRecord,
    rawFields?: Record<string, unknown>,
  ) {
    if (rawFields === undefined) {
      return;
    }

    if (!this.isRecord(rawFields)) {
      throw new BadRequestException('fields must be an object.');
    }

    const fieldDefinitions = PROVIDER_FIELDS[provider];
    const allowedKeys = new Set(fieldDefinitions.map((field) => field.key));

    for (const key of Object.keys(rawFields)) {
      if (!allowedKeys.has(key as SocialAccountFieldKey)) {
        throw new BadRequestException(`Unsupported field for ${provider}: ${key}`);
      }
    }

    for (const field of fieldDefinitions) {
      if (!Object.prototype.hasOwnProperty.call(rawFields, field.key)) {
        continue;
      }

      const nextValue = this.normalizeOptionalString(rawFields[field.key]);
      field.setValue(account, nextValue);
    }
  }

  private assertConfiguredFields(
    provider: SocialAccountProvider,
    account: SocialAccountRecord,
  ) {
    const configuredFieldCount = PROVIDER_FIELDS[provider].filter((field) =>
      Boolean(this.normalizeOptionalString(field.getValue(account))),
    ).length;

    if (configuredFieldCount === 0) {
      throw new BadRequestException(
        'At least one provider field must be filled before saving this account.',
      );
    }
  }

  private serializeProviderSection(
    provider: SocialAccountProvider,
    section: SocialAccountSectionRecord,
  ) {
    const items = [...section.accounts]
      .sort((left, right) => {
        const leftIsDefault = left.id === section.defaultAccountId ? 1 : 0;
        const rightIsDefault = right.id === section.defaultAccountId ? 1 : 0;
        if (leftIsDefault !== rightIsDefault) {
          return rightIsDefault - leftIsDefault;
        }

        return right.updatedAt.localeCompare(left.updatedAt);
      })
      .map((account) =>
        this.serializeAccountSummary(provider, account, section.defaultAccountId),
      );

    return {
      provider,
      providerLabel: PROVIDER_LABELS[provider],
      defaultAccountId: section.defaultAccountId,
      total: items.length,
      items,
    };
  }

  private serializeAccountSummary(
    provider: SocialAccountProvider,
    account: SocialAccountRecord,
    defaultAccountId: string | null,
  ) {
    const configuredFields = PROVIDER_FIELDS[provider].map((field) => {
      const rawValue = this.normalizeOptionalString(field.getValue(account));
      return {
        key: field.key,
        label: field.label,
        configured: Boolean(rawValue),
        maskedValue: rawValue ? this.maskValue(rawValue, Boolean(field.secret)) : null,
        isSecret: Boolean(field.secret),
      };
    });

    return {
      id: account.id,
      label: account.label,
      isDefault: account.id === defaultAccountId,
      connectionStatus: account.connectionStatus,
      connectedAt: account.connectedAt,
      tokenExpiresAt: account.tokenExpiresAt,
      refreshTokenExpiresAt: account.refreshTokenExpiresAt,
      lastValidatedAt: account.lastValidatedAt,
      lastRefreshAttemptAt: account.lastRefreshAttemptAt,
      lastRefreshSuccessAt: account.lastRefreshSuccessAt,
      lastError: account.lastError,
      publicMetadata: account.publicMetadata,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      configuredFieldCount: configuredFields.filter((field) => field.configured)
        .length,
      configuredFields,
    };
  }

  private serializeEditableFieldValues(
    provider: SocialAccountProvider,
    account: SocialAccountRecord,
  ) {
    return Object.fromEntries(
      PROVIDER_FIELDS[provider].map((field) => [
        field.key,
        this.normalizeOptionalString(field.getValue(account)),
      ]),
    );
  }

  private maskValue(value: string, isSecret: boolean) {
    if (isSecret) {
      return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
    }

    if (value.length <= 8) {
      return value;
    }

    return `${value.slice(0, 4)}••••${value.slice(-4)}`;
  }

  private normalizeOptionalString(value: unknown) {
    const normalized = String(value ?? '').trim();
    return normalized ? normalized : null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}