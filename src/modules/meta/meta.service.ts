import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScriptsService } from '../scripts/scripts.service';
import { User } from '../users/entities/user.entity';
import { ExchangeMetaTokenDto } from './dto/exchange-meta-token.dto';
import { MetaUploadDto } from './dto/meta-upload.dto';
import { UpsertMetaCredentialsDto } from './dto/upsert-meta-credentials.dto';
import { MetaCredentialsService } from './meta-credentials.service';
import { MetaCredential } from './entities/meta-credential.entity';

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = (hostname || '').toLowerCase();
  if (!host) return true;

  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return true;
  }
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
      `videoUrl must be publicly reachable from the server. Local/private URLs are not accessible from Meta. Received host: ${parsed.hostname}`,
    );
  }
}

type PlatformResult = {
  success: boolean;
  id?: string;
  url?: string;
  error?: string;
};

type MetaUploadResponse = {
  scriptId: string | null;
  partialFailure: boolean;
  results: {
    facebook?: PlatformResult;
    instagram?: PlatformResult;
  };
};

@Injectable()
export class MetaService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(MetaCredential)
    private readonly metaCredentialRepository: Repository<MetaCredential>,
    private readonly scriptsService: ScriptsService,
    private readonly metaCredentialsService: MetaCredentialsService,
  ) {}

  async getSharedCredentialsStatus() {
    const credentials = await this.getOrCreateSharedCredentials();

    return {
      hasStoredCredentials: Boolean(credentials),
      scope: credentials?.scope ?? 'shared',
      tokenType: credentials?.meta_token_type ?? null,
      metaTokenExpiresAt: credentials?.meta_token_expires_at ?? null,
      hasFacebookPageAccessToken: Boolean(
        credentials?.facebook_page_access_token,
      ),
      facebookPageId:
        credentials?.facebook_page_id ??
        this.getOptionalConfig('META_FACEBOOK_PAGE_ID') ??
        null,
      instagramAccountId:
        credentials?.instagram_account_id ??
        this.getOptionalConfig('META_INSTAGRAM_ACCOUNT_ID') ??
        null,
      connectedAt: credentials?.connected_at ?? null,
      lastRefreshedAt: credentials?.last_refreshed_at ?? null,
      lastError: credentials?.last_error ?? null,
      canAutoRefresh: this.canAutoRefresh(),
    };
  }

  async upsertSharedCredentials(user: User, dto: UpsertMetaCredentialsDto) {
    const credentials = await this.getOrCreateSharedCredentials(true);
    const next =
      credentials ?? this.metaCredentialRepository.create({ scope: 'shared' });

    if (dto.accessToken !== undefined) {
      next.meta_access_token = this.normalizeNullableString(dto.accessToken);
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

    next.connected_at = next.connected_at ?? new Date();
    next.last_error = null;

    const saved = await this.metaCredentialRepository.save(next);
    return {
      saved: true,
      updatedByUserId: user.id,
      status: await this.serializeCredentialStatus(saved),
    };
  }

  async refreshSharedCredentials(user: User) {
    const credentials = await this.getOrCreateSharedCredentials();
    if (!credentials?.meta_access_token) {
      throw new BadRequestException(
        'No stored Meta access token is available to refresh.',
      );
    }

    const refreshed = await this.refreshCredentialIfNeeded(credentials, true);
    return {
      refreshed: true,
      updatedByUserId: user.id,
      status: await this.serializeCredentialStatus(refreshed),
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

    next.meta_access_token = longLivedToken;
    next.meta_token_type =
      this.normalizeNullableString(result.token_type) ?? next.meta_token_type;
    if (Number.isFinite(result.expires_in)) {
      next.meta_token_expires_at = new Date(
        Date.now() + Number(result.expires_in) * 1000,
      );
    }
    next.last_refreshed_at = new Date();
    next.connected_at = next.connected_at ?? new Date();
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
      }
    }

    const saved = await this.metaCredentialRepository.save(next);
    return {
      exchanged: true,
      updatedByUserId: user.id,
      status: await this.serializeCredentialStatus(saved),
    };
  }

  async uploadVideo(
    user: User,
    dto: MetaUploadDto,
  ): Promise<MetaUploadResponse> {
    assertVideoUrlIsPubliclyReachable(dto.videoUrl);
    await this.metaCredentialsService.getActiveMetaCredentials();

    const requestedPlatforms = Array.from(new Set(dto.platforms ?? [])).filter(
      Boolean,
    );
    if (requestedPlatforms.length === 0) {
      throw new BadRequestException(
        'Select at least one Meta platform to upload to.',
      );
    }

    const results: MetaUploadResponse['results'] = {};
    let facebookUrl: string | null = null;
    let instagramUrl: string | null = null;

    for (const platform of requestedPlatforms) {
      if (platform === 'facebook') {
        try {
          const published = await this.publishToFacebook(dto);
          facebookUrl = published.url;
          results.facebook = {
            success: true,
            id: published.id,
            url: published.url,
          };
        } catch (err: unknown) {
          results.facebook = {
            success: false,
            error: this.getErrorMessage(err),
          };
        }
        continue;
      }

      if (platform === 'instagram') {
        try {
          const published = await this.publishToInstagram(dto);
          instagramUrl = published.url;
          results.instagram = {
            success: true,
            id: published.id,
            url: published.url,
          };
        } catch (err: unknown) {
          results.instagram = {
            success: false,
            error: this.getErrorMessage(err),
          };
        }
      }
    }

    if (!facebookUrl && !instagramUrl) {
      const errorMessages = Object.values(results)
        .map((result) => result?.error)
        .filter((message): message is string => Boolean(message));
      throw new BadRequestException(
        errorMessages[0] || 'Meta upload failed unexpectedly.',
      );
    }

    const scriptId = await this.persistUploadResults({
      user,
      dto,
      facebookUrl,
      instagramUrl,
    });

    return {
      scriptId,
      partialFailure: Object.values(results).some(
        (result) => result && !result.success,
      ),
      results,
    };
  }

  private async publishToFacebook(
    dto: MetaUploadDto,
  ): Promise<{ id: string; url: string }> {
    if (dto.isShortVideo) {
      return this.publishFacebookReel(dto);
    }

    const activeCredentials =
      await this.metaCredentialsService.getActiveMetaCredentials();
    const accessToken = activeCredentials.metaAccessToken;
    const appId = this.getRequiredConfig('META_APP_ID');
    const pageId = activeCredentials.facebookPageId;
    if (!pageId) {
      throw new BadRequestException(
        'Missing META_FACEBOOK_PAGE_ID configuration.',
      );
    }
    const version = this.getApiVersion();
    const videoFile = await this.downloadVideo(dto.videoUrl);
    const pageAccessToken = String(
      activeCredentials.facebookPageAccessToken ?? '',
    ).trim();
    if (!pageAccessToken) {
      throw new BadRequestException(
        'Missing Facebook Page access token for the shared Meta connection.',
      );
    }

    const session = await this.fetchJson<{
      id?: string;
    }>(
      `https://graph.facebook.com/${version}/${appId}/uploads?${new URLSearchParams(
        {
          file_name: videoFile.fileName,
          file_length: String(videoFile.size),
          file_type: videoFile.mimeType,
          access_token: accessToken,
        },
      ).toString()}`,
      { method: 'POST' },
      'Failed to create Facebook upload session.',
    );

    const uploadSessionId = String(session?.id ?? '').trim();
    if (!uploadSessionId) {
      throw new BadRequestException(
        'Facebook upload session did not return an id.',
      );
    }

    const uploaded = await this.fetchJson<{ h?: string }>(
      `https://graph.facebook.com/${version}/${uploadSessionId}`,
      {
        method: 'POST',
        headers: {
          Authorization: `OAuth ${accessToken}`,
          file_offset: '0',
          'Content-Type': 'application/octet-stream',
        },
        body: new Uint8Array(videoFile.buffer),
      },
      'Failed to upload video bytes to Facebook.',
    );

    const uploadedHandle = String(uploaded?.h ?? '').trim();
    if (!uploadedHandle) {
      throw new BadRequestException(
        'Facebook upload session did not return a video handle.',
      );
    }

    const publishParams = new URLSearchParams({
      access_token: pageAccessToken,
      description: String(dto.caption ?? '').trim(),
      fbuploader_video_file_chunk: uploadedHandle,
    });
    const title = String(dto.title ?? '').trim();
    if (title) {
      publishParams.set('title', title);
    }

    const published = await this.fetchJson<{ id?: string }>(
      `https://graph-video.facebook.com/${version}/${pageId}/videos`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: publishParams.toString(),
      },
      'Failed to publish video to Facebook.',
    );

    const videoId = String(published?.id ?? '').trim();
    if (!videoId) {
      throw new BadRequestException(
        'Facebook publish did not return a video id.',
      );
    }

    const metadata = await this.fetchJson<Record<string, unknown>>(
      `https://graph.facebook.com/${version}/${videoId}?${new URLSearchParams({
        fields: 'permalink_url',
        access_token: pageAccessToken,
      }).toString()}`,
      { method: 'GET' },
      'Failed to fetch Facebook video permalink.',
    );

    const url = dto.isShortVideo
      ? `https://www.facebook/reel/${videoId}`
      : this.extractFirstUrl(metadata, ['permalink_url', 'link']) ||
        `https://www.facebook.com/watch/?v=${videoId}`;

    return { id: videoId, url };
  }

  private async publishFacebookReel(
    dto: MetaUploadDto,
  ): Promise<{ id: string; url: string }> {
    const activeCredentials =
      await this.metaCredentialsService.getActiveMetaCredentials();
    const pageId = activeCredentials.facebookPageId;
    if (!pageId) {
      throw new BadRequestException(
        'Missing META_FACEBOOK_PAGE_ID configuration.',
      );
    }

    const pageAccessToken = String(
      activeCredentials.facebookPageAccessToken ?? '',
    ).trim();
    if (!pageAccessToken) {
      throw new BadRequestException(
        'Missing Facebook Page access token for the shared Meta connection.',
      );
    }
    const version = this.getApiVersion();

    const startPayload = await this.fetchJson<{
      video_id?: string;
      upload_url?: string;
    }>(
      `https://graph.facebook.com/${version}/${pageId}/video_reels`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          upload_phase: 'start',
          access_token: pageAccessToken,
        }),
      },
      'Failed to initialize Facebook Reels upload session.',
    );

    const videoId = String(startPayload?.video_id ?? '').trim();
    const uploadUrl = String(startPayload?.upload_url ?? '').trim();
    if (!videoId || !uploadUrl) {
      throw new BadRequestException(
        'Facebook Reels upload session did not return a video_id and upload_url.',
      );
    }

    await this.fetchJson<{ success?: boolean }>(
      uploadUrl,
      {
        method: 'POST',
        headers: {
          Authorization: `OAuth ${pageAccessToken}`,
          file_url: dto.videoUrl,
        },
      },
      'Failed to upload hosted video to Facebook Reels.',
    );

    await this.waitForFacebookReelUpload(videoId, pageAccessToken);

    const finishParams = new URLSearchParams({
      access_token: pageAccessToken,
      video_id: videoId,
      upload_phase: 'finish',
      video_state: 'PUBLISHED',
    });

    const description = String(dto.caption ?? '').trim();
    if (description) {
      finishParams.set('description', description);
    }

    const title = String(dto.title ?? '').trim();
    if (title) {
      finishParams.set('title', title);
    }

    await this.fetchJson<{ success?: boolean }>(
      `https://graph.facebook.com/${version}/${pageId}/video_reels`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: finishParams.toString(),
      },
      'Failed to publish Facebook Reel.',
    );

    const url = await this.waitForFacebookReelPermalink(
      videoId,
      pageAccessToken,
    );

    return { id: videoId, url };
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

  private async publishToInstagram(
    dto: MetaUploadDto,
  ): Promise<{ id: string; url: string }> {
    const activeCredentials =
      await this.metaCredentialsService.getActiveMetaCredentials();
    const accessToken = activeCredentials.metaAccessToken;
    const instagramAccountId = activeCredentials.instagramAccountId;
    if (!instagramAccountId) {
      throw new BadRequestException(
        'Missing META_INSTAGRAM_ACCOUNT_ID configuration.',
      );
    }
    const version = this.getApiVersion();

    const createParams = new URLSearchParams({
      access_token: accessToken,
      media_type: dto.isShortVideo ? 'REELS' : 'VIDEO',
      video_url: dto.videoUrl,
    });
    const caption = String(dto.caption ?? '').trim();
    if (caption) {
      createParams.set('caption', caption);
    }

    const created = await this.fetchJson<{ id?: string }>(
      `https://graph.facebook.com/${version}/${instagramAccountId}/media`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: createParams.toString(),
      },
      'Failed to create Instagram media container.',
    );

    const containerId = String(created?.id ?? '').trim();
    if (!containerId) {
      throw new BadRequestException(
        'Instagram container creation did not return an id.',
      );
    }

    await this.waitForInstagramContainer(containerId, accessToken);

    const published = await this.fetchJson<{ id?: string }>(
      `https://graph.facebook.com/${version}/${instagramAccountId}/media_publish`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          access_token: accessToken,
          creation_id: containerId,
        }).toString(),
      },
      'Failed to publish Instagram media.',
    );

    const mediaId = String(published?.id ?? '').trim();
    if (!mediaId) {
      throw new BadRequestException(
        'Instagram publish did not return a media id.',
      );
    }

    const metadata = await this.fetchJson<Record<string, unknown>>(
      `https://graph.facebook.com/${version}/${mediaId}?${new URLSearchParams({
        fields: 'permalink',
        access_token: accessToken,
      }).toString()}`,
      { method: 'GET' },
      'Failed to fetch Instagram permalink.',
    );

    const url = this.extractFirstUrl(metadata, ['permalink']);
    if (!url) {
      throw new BadRequestException(
        'Instagram publish succeeded but no permalink was returned.',
      );
    }

    return { id: mediaId, url };
  }

  private async waitForFacebookReelUpload(
    videoId: string,
    pageAccessToken: string,
  ): Promise<void> {
    const version = this.getApiVersion();
    let lastKnownState = 'unknown';

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const statusPayload = await this.fetchJson<Record<string, unknown>>(
        `https://graph.facebook.com/${version}/${videoId}?${new URLSearchParams(
          {
            fields: 'status',
            access_token: pageAccessToken,
          },
        ).toString()}`,
        { method: 'GET' },
        'Failed to query Facebook Reels upload status.',
      );

      const status =
        statusPayload?.status && typeof statusPayload.status === 'object'
          ? (statusPayload.status as Record<string, any>)
          : null;
      const uploadingPhase =
        status?.uploading_phase && typeof status.uploading_phase === 'object'
          ? (status.uploading_phase as Record<string, any>)
          : null;
      const processingPhase =
        status?.processing_phase && typeof status.processing_phase === 'object'
          ? (status.processing_phase as Record<string, any>)
          : null;
      const publishingPhase =
        status?.publishing_phase && typeof status.publishing_phase === 'object'
          ? (status.publishing_phase as Record<string, any>)
          : null;

      const uploadingStatus = String(uploadingPhase?.status ?? '')
        .trim()
        .toLowerCase();
      const processingStatus = String(processingPhase?.status ?? '')
        .trim()
        .toLowerCase();
      const publishingStatus = String(publishingPhase?.status ?? '')
        .trim()
        .toLowerCase();
      const videoStatus = String(status?.video_status ?? '')
        .trim()
        .toLowerCase();
      const uploadingError = String(
        uploadingPhase?.error?.message ?? '',
      ).trim();
      const processingError = String(
        processingPhase?.error?.message ?? '',
      ).trim();
      const publishingError = String(
        publishingPhase?.error?.message ?? '',
      ).trim();

      lastKnownState = [
        `video_status=${videoStatus || 'unknown'}`,
        `uploading_phase=${uploadingStatus || 'unknown'}`,
        `processing_phase=${processingStatus || 'unknown'}`,
        `publishing_phase=${publishingStatus || 'unknown'}`,
      ].join(', ');

      if (uploadingError) {
        throw new BadRequestException(
          `Facebook Reel upload failed: ${uploadingError}`,
        );
      }

      if (processingError) {
        throw new BadRequestException(
          `Facebook Reel processing failed: ${processingError}`,
        );
      }

      if (publishingError) {
        throw new BadRequestException(
          `Facebook Reel publishing failed: ${publishingError}`,
        );
      }

      const uploadDone =
        uploadingStatus === 'complete' || uploadingStatus === 'completed';
      const uploadFailed = ['error', 'failed', 'expired'].includes(
        uploadingStatus,
      );
      const uploadInterrupted =
        uploadingStatus === 'in_progress' &&
        Number.isFinite(
          Number(
            uploadingPhase?.bytes_transferred ??
              uploadingPhase?.bytes_transfered ??
              NaN,
          ),
        );

      if (uploadFailed) {
        throw new BadRequestException(
          `Facebook Reel upload did not complete successfully. Last known state: ${lastKnownState}`,
        );
      }

      // For Reels, finish publishing can legitimately happen while processing is still
      // queued or in progress. Waiting for processing=complete here causes false timeouts.
      if (uploadDone) {
        return;
      }

      if (
        uploadInterrupted &&
        processingStatus === 'not_started' &&
        (!publishingStatus || publishingStatus === 'not_started')
      ) {
        throw new BadRequestException(
          `Facebook Reel upload appears interrupted and may need a retry from step 1. Last known state: ${lastKnownState}`,
        );
      }

      await this.sleep(5000);
    }

    throw new BadRequestException(
      `Timed out waiting for Facebook Reel upload to finish. Last known state: ${lastKnownState}`,
    );
  }

  private async waitForFacebookReelPermalink(
    videoId: string,
    pageAccessToken: string,
  ): Promise<string> {
    const version = this.getApiVersion();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        const metadata = await this.fetchJson<Record<string, unknown>>(
          `https://graph.facebook.com/${version}/${videoId}?${new URLSearchParams(
            {
              fields: 'permalink_url',
              access_token: pageAccessToken,
            },
          ).toString()}`,
          { method: 'GET' },
          'Failed to fetch Facebook Reel permalink.',
        );

        const url = this.extractFirstUrl(metadata, ['permalink_url', 'link']);
        if (url) {
          return url;
        }
      } catch (error: unknown) {
        if (attempt === 11) {
          throw error;
        }
      }

      await this.sleep(5000);
    }

    return `https://www.facebook.com/reel/${videoId}`;
  }

  private async waitForInstagramContainer(
    containerId: string,
    accessToken: string,
  ): Promise<void> {
    const version = this.getApiVersion();
    const terminalSuccess = new Set(['FINISHED', 'PUBLISHED']);
    const terminalFailure = new Set(['ERROR', 'EXPIRED']);

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const statusPayload = await this.fetchJson<Record<string, unknown>>(
        `https://graph.facebook.com/${version}/${containerId}?${new URLSearchParams(
          {
            fields: 'status_code,status',
            access_token: accessToken,
          },
        ).toString()}`,
        { method: 'GET' },
        'Failed to query Instagram container status.',
      );

      const statusCode = String(
        statusPayload?.status_code ?? statusPayload?.status ?? '',
      )
        .trim()
        .toUpperCase();

      if (terminalSuccess.has(statusCode)) {
        return;
      }

      if (terminalFailure.has(statusCode)) {
        throw new BadRequestException(
          `Instagram container processing failed with status ${statusCode}.`,
        );
      }

      await this.sleep(5000);
    }

    throw new BadRequestException(
      'Timed out waiting for Instagram media processing.',
    );
  }

  private async persistUploadResults(params: {
    user: User;
    dto: MetaUploadDto;
    facebookUrl: string | null;
    instagramUrl: string | null;
  }): Promise<string | null> {
    const { user, dto, facebookUrl, instagramUrl } = params;
    const scriptIdRaw = String(dto.scriptId ?? '').trim();
    const scriptTextRaw = String(dto.scriptText ?? '').trim();
    const saveBeforeUpload = dto.saveBeforeUpload;
    const payload: Record<string, unknown> = {
      facebook_url: facebookUrl,
      instagram_url: instagramUrl,
    };

    const cleanedTitle = String(dto.title ?? '').trim();
    if (cleanedTitle) {
      payload.title = cleanedTitle;
    }

    const cleanedVideoUrl = String(
      saveBeforeUpload?.video_url ?? dto.videoUrl ?? '',
    ).trim();
    if (cleanedVideoUrl) {
      payload.video_url = cleanedVideoUrl;
    }

    if (saveBeforeUpload?.script !== undefined) {
      payload.script = saveBeforeUpload.script;
    }

    if (saveBeforeUpload?.voice_id !== undefined) {
      payload.voice_id = saveBeforeUpload.voice_id;
    }

    if (saveBeforeUpload?.sentences !== undefined) {
      payload.sentences = saveBeforeUpload.sentences;
    }

    if (scriptIdRaw) {
      await this.scriptsService.update(scriptIdRaw, user.id, payload as any);
      return scriptIdRaw;
    }

    const scriptToPersist = String(
      saveBeforeUpload?.script ?? scriptTextRaw,
    ).trim();
    if (!scriptToPersist) {
      return null;
    }

    const saved = await this.scriptsService.create(user.id, {
      script: scriptToPersist,
      title: cleanedTitle || undefined,
      video_url: cleanedVideoUrl || undefined,
      voice_id: saveBeforeUpload?.voice_id,
      sentences: saveBeforeUpload?.sentences,
      facebook_url: facebookUrl,
      instagram_url: instagramUrl,
    } as any);
    return saved?.id ?? null;
  }

  private async downloadVideo(videoUrl: string): Promise<{
    buffer: Buffer;
    fileName: string;
    mimeType: string;
    size: number;
  }> {
    let response: Response;
    try {
      response = await fetch(videoUrl, { redirect: 'follow' } as any);
    } catch (err: any) {
      throw new BadRequestException(
        `Unable to download video from videoUrl. Ensure it is a public URL reachable from the backend. Details: ${err?.message || 'fetch failed'}`,
      );
    }

    if (!response.ok) {
      throw new BadRequestException(
        `Failed to download video from videoUrl (status ${response.status}).`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.byteLength) {
      throw new BadRequestException('Downloaded video is empty.');
    }

    const fileName = this.getFileNameFromUrl(videoUrl);
    const contentType = this.normalizeVideoMimeType(
      response.headers.get('content-type'),
      fileName,
    );

    return {
      buffer,
      fileName,
      mimeType: contentType,
      size: buffer.byteLength,
    };
  }

  private normalizeVideoMimeType(
    rawContentType: string | null,
    fileName: string,
  ): string {
    const normalizedHeader = String(rawContentType ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();

    if (normalizedHeader === 'video/mp4') {
      return normalizedHeader;
    }

    const lowerName = String(fileName ?? '')
      .trim()
      .toLowerCase();
    if (lowerName.endsWith('.mp4')) {
      return 'video/mp4';
    }

    if (normalizedHeader) {
      throw new BadRequestException(
        `Unsupported video content type for Meta upload: ${normalizedHeader}. Expected video/mp4.`,
      );
    }

    throw new BadRequestException(
      'Unable to determine a supported video content type for Meta upload. Expected an MP4 video.',
    );
  }

  private getFileNameFromUrl(urlString: string): string {
    try {
      const parsed = new URL(urlString);
      const lastSegment = String(parsed.pathname.split('/').pop() ?? '').trim();
      if (lastSegment) {
        return lastSegment;
      }
    } catch {
      // ignore parsing failure and fall back
    }

    return 'video.mp4';
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
          credentials = await this.metaCredentialRepository.save(credentials);
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
      last_error: null,
    });

    return await this.metaCredentialRepository.save(credentials);
  }

  private async refreshCredentialIfNeeded(
    credentials: MetaCredential,
    force = false,
  ): Promise<MetaCredential> {
    if (!credentials.meta_access_token) {
      return credentials;
    }

    if (!this.canAutoRefresh()) {
      return credentials;
    }

    const shouldRefresh = force || this.shouldRefreshCredential(credentials);
    if (!shouldRefresh) {
      return credentials;
    }

    const appId = this.getRequiredConfig('META_APP_ID');
    const appSecret = this.getRequiredConfig('META_APP_SECRET');
    const version = this.getApiVersion();

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
        'Failed to refresh Meta access token.',
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
      credentials.last_refreshed_at = new Date();
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
        }
      }

      return await this.metaCredentialRepository.save(credentials);
    } catch (error: unknown) {
      credentials.last_error = this.getErrorMessage(error);
      await this.metaCredentialRepository.save(credentials);
      if (force) {
        throw error;
      }
      return credentials;
    }
  }

  private shouldRefreshCredential(credentials: MetaCredential): boolean {
    if (!credentials.meta_access_token) {
      return false;
    }

    const expiresAtMs = credentials.meta_token_expires_at?.getTime() ?? null;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if (expiresAtMs !== null && expiresAtMs - Date.now() <= sevenDaysMs) {
      return true;
    }

    const lastRefreshedAtMs = credentials.last_refreshed_at?.getTime() ?? 0;
    const oneDayMs = 24 * 60 * 60 * 1000;
    return Date.now() - lastRefreshedAtMs >= oneDayMs;
  }

  private canAutoRefresh(): boolean {
    return Boolean(this.getOptionalConfig('META_APP_SECRET'));
  }

  private async serializeCredentialStatus(credentials: MetaCredential) {
    return {
      scope: credentials.scope,
      tokenType: credentials.meta_token_type,
      metaTokenExpiresAt: credentials.meta_token_expires_at,
      hasMetaAccessToken: Boolean(credentials.meta_access_token),
      hasFacebookPageAccessToken: Boolean(
        credentials.facebook_page_access_token,
      ),
      facebookPageId: credentials.facebook_page_id,
      instagramAccountId: credentials.instagram_account_id,
      connectedAt: credentials.connected_at,
      lastRefreshedAt: credentials.last_refreshed_at,
      lastError: credentials.last_error,
      canAutoRefresh: this.canAutoRefresh(),
    };
  }

  private getApiVersion(): string {
    const configured = String(
      this.configService.get<string>('META_API_VERSION') ?? '',
    ).trim();
    return configured || 'v25.0';
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

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
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

  private extractFirstUrl(
    payload: Record<string, unknown>,
    fields: string[],
  ): string | null {
    for (const field of fields) {
      const value = String(payload?.[field] ?? '').trim();
      if (value) {
        return value;
      }
    }
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

    return 'Unexpected Meta upload failure.';
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
