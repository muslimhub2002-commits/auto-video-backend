import { Injectable } from '@nestjs/common';
import {
  UploadBufferParams,
  UploadFromUrlParams,
  UploadResult,
} from '../uploads.types';
import {
  buildProviderRef,
  ensureUploadFilename,
  extractFilestackHandleFromUrl,
  sanitizeUploadFolder,
} from '../uploads.utils';

@Injectable()
export class FilestackUploadProvider {
  readonly name = 'filestack' as const;

  isConfigured() {
    return Boolean(process.env.FILESTACK_API_KEY);
  }

  private get apiKey() {
    return String(process.env.FILESTACK_API_KEY ?? '').trim();
  }

  private buildStoreUrl(params: {
    folder: string;
    filename?: string | null;
    mimeType?: string | null;
  }) {
    const url = new URL('https://www.filestackapi.com/api/store/S3');
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('path', `${sanitizeUploadFolder(params.folder)}/`);

    const filename = String(params.filename ?? '').trim();
    if (filename) {
      url.searchParams.set('filename', filename);
    }

    const mimeType = String(params.mimeType ?? '').trim();
    if (mimeType) {
      url.searchParams.set('mimetype', mimeType);
    }

    return url.toString();
  }

  private toUploadResult(payload: any): UploadResult {
    const url = String(payload?.url ?? '').trim();
    if (!url) {
      throw new Error('Filestack upload did not return a CDN URL');
    }

    const handle = extractFilestackHandleFromUrl(url);
    return {
      provider: this.name,
      url,
      providerRef: buildProviderRef(this.name, handle),
      expiresAt: null,
    };
  }

  async uploadBuffer(params: UploadBufferParams): Promise<UploadResult> {
    if (!this.isConfigured()) {
      throw new Error('Filestack environment variables are not configured');
    }

    const response = await fetch(
      this.buildStoreUrl({
        folder: params.folder,
        filename: ensureUploadFilename(params.filename, 'upload.bin'),
        mimeType: params.mimeType,
      }),
      {
        method: 'POST',
        headers: {
          'Content-Type':
            String(params.mimeType ?? '').trim() || 'application/octet-stream',
        },
        body: new Uint8Array(params.buffer),
      },
    );

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        `Filestack upload failed (${response.status}): ${JSON.stringify(payload)}`,
      );
    }

    return this.toUploadResult(payload);
  }

  async uploadFromUrl(params: UploadFromUrlParams): Promise<UploadResult> {
    if (!this.isConfigured()) {
      throw new Error('Filestack environment variables are not configured');
    }

    const response = await fetch(
      this.buildStoreUrl({
        folder: params.folder,
        filename: params.filename,
        mimeType: params.mimeType,
      }),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ url: params.sourceUrl }).toString(),
      },
    );

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        `Filestack URL upload failed (${response.status}): ${JSON.stringify(payload)}`,
      );
    }

    return this.toUploadResult(payload);
  }

  async deleteByRef() {
    throw new Error('Filestack delete requires additional security credentials');
  }
}
