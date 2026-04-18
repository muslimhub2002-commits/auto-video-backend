import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { withTimeout } from '../../render-videos/utils/promise.utils';
import {
  UploadBufferParams,
  UploadFromUrlParams,
  UploadResult,
} from '../uploads.types';
import {
  buildProviderRef,
  resourceTypeToCloudinaryResourceType,
  sanitizeUploadFolder,
} from '../uploads.utils';

const CLOUDINARY_STANDARD_IMAGE_TIMEOUT_MS = 60_000;
const CLOUDINARY_STANDARD_MEDIA_TIMEOUT_MS = 3 * 60_000;
const CLOUDINARY_LARGE_MEDIA_TIMEOUT_MS = 15 * 60_000;
const CLOUDINARY_LARGE_MEDIA_CHUNK_SIZE_BYTES = 20 * 1024 * 1024;

@Injectable()
export class CloudinaryUploadProvider {
  readonly name = 'cloudinary' as const;
  private deliveryAvailabilityCheckedAt = 0;
  private deliveryAvailabilityCached: boolean | null = null;

  private isChunkedMediaUpload(
    resourceType: UploadBufferParams['resourceType'],
  ) {
    return resourceType !== 'image';
  }

  private getTimeoutMs(resourceType: UploadBufferParams['resourceType']) {
    if (resourceType === 'image') {
      return CLOUDINARY_STANDARD_IMAGE_TIMEOUT_MS;
    }

    return this.isChunkedMediaUpload(resourceType)
      ? CLOUDINARY_LARGE_MEDIA_TIMEOUT_MS
      : CLOUDINARY_STANDARD_MEDIA_TIMEOUT_MS;
  }

  isConfigured() {
    return Boolean(
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_CLOUD_SECRET,
    );
  }

  private ensureConfigured() {
    if (!this.isConfigured()) {
      throw new Error('Cloudinary environment variables are not configured');
    }

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_CLOUD_SECRET,
    });
  }

  async canDeliverPublicAssets() {
    if (!this.isConfigured()) {
      return false;
    }

    const now = Date.now();
    if (
      this.deliveryAvailabilityCached !== null &&
      now - this.deliveryAvailabilityCheckedAt < 5 * 60_000
    ) {
      return this.deliveryAvailabilityCached;
    }

    try {
      this.ensureConfigured();
      await cloudinary.api.ping();
      this.deliveryAvailabilityCached = true;
    } catch {
      this.deliveryAvailabilityCached = false;
    }

    this.deliveryAvailabilityCheckedAt = now;
    return this.deliveryAvailabilityCached;
  }

  async uploadBuffer(params: UploadBufferParams): Promise<UploadResult> {
    this.ensureConfigured();

    const folder = sanitizeUploadFolder(params.folder);
    const resourceType = resourceTypeToCloudinaryResourceType(
      params.resourceType,
    );

    const uploadPromise = this.isChunkedMediaUpload(params.resourceType)
      ? new Promise<any>((resolve, reject) => {
          const stream = cloudinary.uploader.upload_large_stream(
            {
              folder,
              resource_type: resourceType,
              overwrite: false,
              use_filename: false,
              chunk_size: CLOUDINARY_LARGE_MEDIA_CHUNK_SIZE_BYTES,
            },
            (result: any) => {
              if (!result) {
                return reject(new Error('Cloudinary large upload failed'));
              }

              if (result.error) {
                return reject(result.error);
              }

              resolve(result);
            },
          );

          stream.end(params.buffer);
        })
      : new Promise<any>((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder,
              resource_type: resourceType,
              overwrite: false,
              use_filename: false,
            },
            (error, result) => {
              if (error || !result) {
                return reject(error ?? new Error('Cloudinary upload failed'));
              }

              resolve(result);
            },
          );

          stream.end(params.buffer);
        });

    const uploadResult = await withTimeout(
      uploadPromise,
      this.getTimeoutMs(params.resourceType),
      `Cloudinary ${resourceType} upload`,
    );

    if (!uploadResult?.secure_url) {
      throw new Error('Cloudinary upload did not return a secure_url');
    }

    return {
      provider: this.name,
      url: String(uploadResult.secure_url),
      providerRef: buildProviderRef(this.name, uploadResult.public_id),
      expiresAt: null,
    };
  }

  async uploadFromUrl(params: UploadFromUrlParams): Promise<UploadResult> {
    this.ensureConfigured();

    const resourceType = resourceTypeToCloudinaryResourceType(
      params.resourceType,
    );

    const uploadResult: any = await withTimeout(
      this.isChunkedMediaUpload(params.resourceType)
        ? cloudinary.uploader.upload_large(params.sourceUrl, {
            folder: sanitizeUploadFolder(params.folder),
            resource_type: resourceType,
            overwrite: false,
            use_filename: false,
            chunk_size: CLOUDINARY_LARGE_MEDIA_CHUNK_SIZE_BYTES,
          })
        : cloudinary.uploader.upload(params.sourceUrl, {
            folder: sanitizeUploadFolder(params.folder),
            resource_type: resourceType,
            overwrite: false,
            use_filename: false,
          }),
      this.getTimeoutMs(params.resourceType),
      'Cloudinary remote upload',
    );

    if (!uploadResult?.secure_url) {
      throw new Error('Cloudinary remote upload did not return a secure_url');
    }

    return {
      provider: this.name,
      url: String(uploadResult.secure_url),
      providerRef: buildProviderRef(this.name, uploadResult.public_id),
      expiresAt: null,
    };
  }

  async deleteByRef(
    providerRef: string,
    resourceType: UploadBufferParams['resourceType'],
  ) {
    this.ensureConfigured();

    const normalizedRef = String(providerRef ?? '').trim();
    if (!normalizedRef) return;

    await cloudinary.uploader.destroy(normalizedRef, {
      resource_type: resourceTypeToCloudinaryResourceType(resourceType),
    });
  }
}
