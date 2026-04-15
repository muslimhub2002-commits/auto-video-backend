import { Injectable } from '@nestjs/common';
import { SmashUploader } from '@smash-sdk/uploader';
import {
  UploadBufferParams,
  UploadResult,
} from '../uploads.types';
import {
  buildProviderRef,
  deriveSmashRegionFromToken,
  ensureUploadFilename,
} from '../uploads.utils';

@Injectable()
export class SmashUploadProvider {
  readonly name = 'smash' as const;

  private get token() {
    return String(process.env.SMASH_API_KEY ?? '').trim();
  }

  private get region() {
    return deriveSmashRegionFromToken(this.token) ?? 'eu-west-3';
  }

  isConfigured() {
    return Boolean(this.token);
  }

  async uploadBuffer(params: UploadBufferParams): Promise<UploadResult> {
    if (!this.isConfigured()) {
      throw new Error('Smash environment variables are not configured');
    }

    const uploader = new SmashUploader({
      token: this.token,
      region: this.region as any,
    });

    const result = await uploader.upload({
      files: [
        {
          name: ensureUploadFilename(params.filename, 'upload.bin'),
          content: params.buffer,
        },
      ],
      title: ensureUploadFilename(params.filename, 'upload.bin'),
      availabilityDuration: 30 * 24 * 60 * 60,
      preview: 'Full',
    });

    const transferUrl = String(result?.transfer?.transferUrl ?? '').trim();
    if (!transferUrl) {
      throw new Error('Smash upload did not return a transferUrl');
    }

    return {
      provider: this.name,
      url: transferUrl,
      providerRef: buildProviderRef(this.name, result?.transfer?.id),
      expiresAt: String(result?.transfer?.availabilityEndDate ?? '').trim() || null,
    };
  }

  async deleteByRef() {
    throw new Error('Smash delete is not implemented yet');
  }
}
