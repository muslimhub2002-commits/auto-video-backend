export type UploadProviderName =
  | 'cloudinary'
  | 'uploadcare'
  | 'filestack'
  | 'smash';

export type UploadResourceType = 'image' | 'video' | 'audio';

export type UploadBufferParams = {
  buffer: Buffer;
  filename: string;
  mimeType?: string | null;
  folder: string;
  resourceType: UploadResourceType;
};

export type UploadFromUrlParams = {
  sourceUrl: string;
  filename?: string | null;
  mimeType?: string | null;
  folder: string;
  resourceType: UploadResourceType;
};

export type UploadResult = {
  provider: UploadProviderName;
  url: string;
  providerRef: string | null;
  expiresAt: string | null;
};
