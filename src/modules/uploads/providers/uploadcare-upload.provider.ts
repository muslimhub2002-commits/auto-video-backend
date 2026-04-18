import { Injectable } from '@nestjs/common';
import {
  UploadBufferParams,
  UploadFromUrlParams,
  UploadResult,
} from '../uploads.types';
import {
  buildProviderRef,
  ensureUploadFilename,
  extractUploadcareUuid,
  findUuidInUnknownPayload,
  getUploadcareDirectUploadMaxBytes,
  isCanonicalUploadcareUrl,
  sanitizeUploadFolder,
  sleep,
} from '../uploads.utils';

type UploadcareFileInfo = {
  original_file_url?: string;
  original_filename?: string;
  cdn_url?: string;
  uuid?: string;
};

@Injectable()
export class UploadcareUploadProvider {
  readonly name = 'uploadcare' as const;

  isConfigured() {
    return Boolean(
      process.env.UPLOADCARE_API_KEY && process.env.UPLOADCARE_SECRET_KEY,
    );
  }

  supportsBufferUpload(params: UploadBufferParams) {
    return params.buffer.length <= getUploadcareDirectUploadMaxBytes();
  }

  private get publicKey() {
    return String(process.env.UPLOADCARE_API_KEY ?? '').trim();
  }

  private get secretKey() {
    return String(process.env.UPLOADCARE_SECRET_KEY ?? '').trim();
  }

  private get restHeaders() {
    return {
      Authorization: `Uploadcare.Simple ${this.publicKey}:${this.secretKey}`,
      Accept: 'application/vnd.uploadcare-v0.7+json',
    };
  }

  private parseResponsePayload = async (response: Response) => {
    const text = await response.text();
    if (!text) return {};

    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  };

  private async fetchFileInfo(uuid: string): Promise<UploadcareFileInfo> {
    const response = await fetch(`https://api.uploadcare.com/files/${uuid}/`, {
      method: 'GET',
      headers: this.restHeaders,
    });

    const payload = await this.parseResponsePayload(response);
    if (!response.ok) {
      throw new Error(
        `Uploadcare file lookup failed (${response.status}): ${JSON.stringify(payload)}`,
      );
    }

    return payload as UploadcareFileInfo;
  }

  private async resolveCanonicalUrl(
    uuid: string,
    fallbackFilename?: string | null,
  ): Promise<string> {
    const fileInfo = await this.fetchFileInfo(uuid);
    const originalFileUrl = String(fileInfo.original_file_url ?? '').trim();
    if (originalFileUrl) {
      return originalFileUrl;
    }

    const cdnUrl = String(fileInfo.cdn_url ?? '').trim();
    if (cdnUrl) {
      const filename = ensureUploadFilename(
        fileInfo.original_filename ?? fallbackFilename,
        'upload.bin',
      );
      const separator = cdnUrl.endsWith('/') ? '' : '/';
      return `${cdnUrl}${separator}${encodeURIComponent(filename)}`;
    }

    throw new Error(`Uploadcare file ${uuid} did not return a public file URL`);
  }

  async normalizeUrl(
    rawUrl: string,
    fallbackFilename?: string | null,
  ): Promise<string> {
    if (isCanonicalUploadcareUrl(rawUrl)) {
      return rawUrl;
    }

    const uuid = extractUploadcareUuid(rawUrl);
    if (!uuid) {
      return rawUrl;
    }

    return this.resolveCanonicalUrl(uuid, fallbackFilename);
  }

  async uploadBuffer(params: UploadBufferParams): Promise<UploadResult> {
    if (!this.isConfigured()) {
      throw new Error('Uploadcare environment variables are not configured');
    }

    if (!this.supportsBufferUpload(params)) {
      throw new Error(
        'Uploadcare direct upload only supports files up to 100 MiB',
      );
    }

    const form = new FormData();
    form.append('UPLOADCARE_PUB_KEY', this.publicKey);
    form.append('UPLOADCARE_STORE', '1');
    form.append('metadata[folder]', sanitizeUploadFolder(params.folder));
    form.append('metadata[resourceType]', params.resourceType);
    form.append(
      'file',
      new Blob([new Uint8Array(params.buffer)], {
        type:
          String(params.mimeType ?? '').trim() || 'application/octet-stream',
      }),
      ensureUploadFilename(params.filename, 'upload.bin'),
    );

    const response = await fetch('https://upload.uploadcare.com/base/', {
      method: 'POST',
      body: form,
    });

    const payload = await this.parseResponsePayload(response);
    if (!response.ok) {
      throw new Error(
        `Uploadcare upload failed (${response.status}): ${JSON.stringify(payload)}`,
      );
    }

    const uuid = findUuidInUnknownPayload(payload);
    if (!uuid) {
      throw new Error('Uploadcare upload did not return a file UUID');
    }

    return {
      provider: this.name,
      url: await this.resolveCanonicalUrl(uuid, params.filename),
      providerRef: buildProviderRef(this.name, uuid),
      expiresAt: null,
    };
  }

  async uploadFromUrl(params: UploadFromUrlParams): Promise<UploadResult> {
    if (!this.isConfigured()) {
      throw new Error('Uploadcare environment variables are not configured');
    }

    const form = new FormData();
    form.append('UPLOADCARE_PUB_KEY', this.publicKey);
    form.append('source_url', params.sourceUrl);
    form.append('store', '1');
    form.append('metadata[folder]', sanitizeUploadFolder(params.folder));
    form.append('metadata[resourceType]', params.resourceType);

    const response = await fetch('https://upload.uploadcare.com/from_url/', {
      method: 'POST',
      body: form,
    });

    const payload = await this.parseResponsePayload(response);
    if (!response.ok) {
      throw new Error(
        `Uploadcare URL upload failed (${response.status}): ${JSON.stringify(payload)}`,
      );
    }

    const immediateUuid = findUuidInUnknownPayload(payload);
    if (immediateUuid) {
      return {
        provider: this.name,
        url: await this.resolveCanonicalUrl(immediateUuid, params.filename),
        providerRef: buildProviderRef(this.name, immediateUuid),
        expiresAt: null,
      };
    }

    const token = String(payload?.token ?? '').trim();
    if (!token) {
      throw new Error('Uploadcare URL upload did not return a polling token');
    }

    for (let attempt = 0; attempt < 45; attempt += 1) {
      await sleep(2_000);

      const statusForm = new FormData();
      statusForm.append('UPLOADCARE_PUB_KEY', this.publicKey);
      statusForm.append('token', token);

      const statusResponse = await fetch(
        'https://upload.uploadcare.com/from_url/status/',
        {
          method: 'POST',
          body: statusForm,
        },
      );

      const statusPayload = await this.parseResponsePayload(statusResponse);
      if (!statusResponse.ok) {
        throw new Error(
          `Uploadcare status polling failed (${statusResponse.status}): ${JSON.stringify(statusPayload)}`,
        );
      }

      const uuid = findUuidInUnknownPayload(statusPayload);
      if (uuid) {
        return {
          provider: this.name,
          url: await this.resolveCanonicalUrl(uuid, params.filename),
          providerRef: buildProviderRef(this.name, uuid),
          expiresAt: null,
        };
      }

      const errorMessage = String(statusPayload?.error ?? '').trim();
      if (errorMessage) {
        throw new Error(`Uploadcare URL upload failed: ${errorMessage}`);
      }
    }

    throw new Error(
      'Uploadcare URL upload timed out while waiting for completion',
    );
  }

  async deleteByRef() {
    throw new Error('Uploadcare delete is not implemented yet');
  }
}
