import { User } from '../../users/entities/user.entity';

export function sanitizeAuthUser(user: User): Partial<User> {
  const {
    password,
    google_subject,
    youtube_access_token,
    youtube_refresh_token,
    youtube_token_expiry,
    youtube_connected_at,
    tiktok_access_token,
    tiktok_refresh_token,
    tiktok_token_expiry,
    tiktok_refresh_token_expiry,
    tiktok_open_id,
    tiktok_scope,
    tiktok_connected_at,
    tiktok_oauth_state,
    tiktok_code_verifier,
    tiktok_oauth_started_at,
    youtube_accounts,
    meta_accounts,
    tiktok_accounts,
    ...safeUser
  } = user;

  return safeUser;
}