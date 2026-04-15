import {
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { downloadUrlToBuffer } from '../render-videos/utils/net.utils';
import { CloudinaryUploadProvider } from './providers/cloudinary-upload.provider';
import { FilestackUploadProvider } from './providers/filestack-upload.provider';
import { SmashUploadProvider } from './providers/smash-upload.provider';
import { UploadcareUploadProvider } from './providers/uploadcare-upload.provider';
import {
  UploadBufferParams,
  UploadFromUrlParams,
  UploadProviderName,
  UploadResourceType,
  UploadResult,
} from './uploads.types';
import {
  detectManagedUploadProvider,
  inferFilenameFromUrl,
  isHttpUrl,
  parseProviderRef,
  sanitizeUploadFolder,
} from './uploads.utils';

@Injectable()
export class UploadsService {
  constructor(
    private readonly cloudinaryProvider: CloudinaryUploadProvider,
    private readonly uploadcareProvider: UploadcareUploadProvider,
    private readonly filestackProvider: FilestackUploadProvider,
    private readonly smashProvider: SmashUploadProvider,
  ) {}

  private get orderedProviders() {
    return [
      this.cloudinaryProvider,
      this.uploadcareProvider,
      this.filestackProvider,
      this.smashProvider,
    ];
  }

  isManagedUrl(url: string) {
    return detectManagedUploadProvider(url) !== null;
  }

  async isCloudinaryDeliveryAvailable() {
    return this.cloudinaryProvider.canDeliverPublicAssets();
  }

  private throwNoProviderError(
    resourceType: UploadResourceType,
    errors: string[],
  ): never {
    const detail = errors.length > 0 ? ` ${errors.join(' | ')}` : '';
    throw new InternalServerErrorException(
      `No upload provider succeeded for ${resourceType}.${detail}`,
    );
  }

  async uploadBuffer(params: UploadBufferParams): Promise<UploadResult> {
    const normalizedParams: UploadBufferParams = {
      ...params,
      folder: sanitizeUploadFolder(params.folder),
    };

    const errors: string[] = [];

    for (const provider of this.orderedProviders) {
      if (!provider.isConfigured()) {
        errors.push(`${provider.name}:not-configured`);
        continue;
      }

      if (
        'supportsBufferUpload' in provider &&
        typeof provider.supportsBufferUpload === 'function' &&
        !provider.supportsBufferUpload(normalizedParams)
      ) {
        errors.push(`${provider.name}:unsupported-buffer-upload`);
        continue;
      }

      try {
        return await provider.uploadBuffer(normalizedParams as any);
      } catch (error: any) {
        errors.push(
          `${provider.name}:${String(error?.message ?? 'upload-failed')}`,
        );
      }
    }

    this.throwNoProviderError(normalizedParams.resourceType, errors);
  }

  async uploadFromUrl(params: UploadFromUrlParams): Promise<UploadResult> {
    const normalizedParams: UploadFromUrlParams = {
      ...params,
      folder: sanitizeUploadFolder(params.folder),
    };
    const errors: string[] = [];

    for (const provider of this.orderedProviders) {
      if (!provider.isConfigured()) {
        errors.push(`${provider.name}:not-configured`);
        continue;
      }

      if (typeof (provider as any).uploadFromUrl !== 'function') {
        errors.push(`${provider.name}:no-url-upload`);
        continue;
      }

      try {
        return await (provider as any).uploadFromUrl(normalizedParams);
      } catch (error: any) {
        errors.push(
          `${provider.name}:${String(error?.message ?? 'url-upload-failed')}`,
        );
      }
    }

    if (!isHttpUrl(normalizedParams.sourceUrl)) {
      this.throwNoProviderError(normalizedParams.resourceType, errors);
    }

    const downloaded = await downloadUrlToBuffer({
      url: normalizedParams.sourceUrl,
      maxBytes: normalizedParams.resourceType === 'image'
        ? 25 * 1024 * 1024
        : 250 * 1024 * 1024,
      label: `upload source ${normalizedParams.resourceType}`,
    });

    return this.uploadBuffer({
      buffer: downloaded.buffer,
      filename: normalizedParams.filename
        ? normalizedParams.filename
        : inferFilenameFromUrl(
            normalizedParams.sourceUrl,
            normalizedParams.resourceType === 'image'
              ? 'upload.png'
              : normalizedParams.resourceType === 'audio'
                ? 'upload.mp3'
                : 'upload.mp4',
          ),
      mimeType: normalizedParams.mimeType ?? downloaded.mimeType,
      folder: normalizedParams.folder,
      resourceType: normalizedParams.resourceType,
    });
  }

  async ensurePublicUrl(params: UploadFromUrlParams): Promise<UploadResult> {
    const normalizedUrl = String(params.sourceUrl ?? '').trim();
    const existingProvider = detectManagedUploadProvider(normalizedUrl);

    if (existingProvider === 'uploadcare') {
      return {
        provider: existingProvider,
        url: await this.uploadcareProvider.normalizeUrl(
          normalizedUrl,
          params.filename,
        ),
        providerRef: null,
        expiresAt: null,
      };
    }

    if (existingProvider) {
      return {
        provider: existingProvider,
        url: normalizedUrl,
        providerRef: null,
        expiresAt: null,
      };
    }

    return this.uploadFromUrl(params);
  }

  async deleteByRef(params: {
    providerRef?: string | null;
    resourceType: UploadResourceType;
  }) {
    const parsed = parseProviderRef(params.providerRef);
    if (!parsed) return;

    const providers: Record<UploadProviderName, any> = {
      cloudinary: this.cloudinaryProvider,
      uploadcare: this.uploadcareProvider,
      filestack: this.filestackProvider,
      smash: this.smashProvider,
    };

    const provider = providers[parsed.provider];
    if (!provider || typeof provider.deleteByRef !== 'function') {
      return;
    }

    await provider.deleteByRef(parsed.rawRef, params.resourceType);
  }
}
