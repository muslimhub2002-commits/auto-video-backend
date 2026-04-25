export type UserSocialAccountConnectionStatus =
  | 'draft'
  | 'not_connected'
  | 'healthy'
  | 'attention'
  | 'reconnect_required'
  | 'error';

export type UserSocialAccountSection<TAccount> = {
  version: 1;
  defaultAccountId: string | null;
  accounts: TAccount[];
};

export type UserYoutubeAccountCredentials = {
  clientId?: string | null;
  clientSecret?: string | null;
};

export type UserYoutubeAccountTokens = {
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiry?: string | null;
  connectedAt?: string | null;
};

export type UserMetaAccountCredentials = {
  appId?: string | null;
  appSecret?: string | null;
  facebookPageId?: string | null;
  instagramAccountId?: string | null;
  instagramPageAccessToken?: string | null;
};

export type UserMetaAccountTokens = {
  metaAccessToken?: string | null;
  tokenType?: string | null;
  tokenExpiresAt?: string | null;
  facebookPageAccessToken?: string | null;
  facebookPageTokenExpiresAt?: string | null;
  connectedAt?: string | null;
  lastRefreshedAt?: string | null;
  lastRefreshAttemptAt?: string | null;
  lastRefreshSuccessAt?: string | null;
  lastRefreshErrorAt?: string | null;
  nextRefreshDueAt?: string | null;
  requiresReconnectAt?: string | null;
};

export type UserTikTokAccountCredentials = {
  clientKey?: string | null;
  clientSecret?: string | null;
};

export type UserTikTokAccountTokens = {
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiry?: string | null;
  refreshTokenExpiry?: string | null;
  openId?: string | null;
  scope?: string | null;
  connectedAt?: string | null;
  oauthState?: string | null;
  codeVerifier?: string | null;
  oauthStartedAt?: string | null;
};

export type UserStoredSocialAccount<
  TCredentials extends Record<string, string | null | undefined>,
  TTokens extends Record<string, string | null | undefined>,
> = {
  id: string;
  label: string;
  credentials: TCredentials;
  tokens: TTokens;
  publicMetadata: Record<string, unknown> | null;
  connectionStatus: UserSocialAccountConnectionStatus;
  connectedAt: string | null;
  tokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  lastValidatedAt: string | null;
  lastRefreshAttemptAt: string | null;
  lastRefreshSuccessAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UserYoutubeAccount = UserStoredSocialAccount<
  UserYoutubeAccountCredentials,
  UserYoutubeAccountTokens
>;

export type UserMetaAccount = UserStoredSocialAccount<
  UserMetaAccountCredentials,
  UserMetaAccountTokens
>;

export type UserTikTokAccount = UserStoredSocialAccount<
  UserTikTokAccountCredentials,
  UserTikTokAccountTokens
>;

export type UserYoutubeAccountSection = UserSocialAccountSection<UserYoutubeAccount>;
export type UserMetaAccountSection = UserSocialAccountSection<UserMetaAccount>;
export type UserTikTokAccountSection = UserSocialAccountSection<UserTikTokAccount>;