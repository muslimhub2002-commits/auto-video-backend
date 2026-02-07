export type SentenceInput = {
  text: string;
  isSuspense?: boolean;
  mediaType?: 'image' | 'video';
  videoUrl?: string;
};

export type UploadedAsset = {
  buffer: Buffer;
  originalName: string;
  mimeType?: string;
};

export type UrlAsset = {
  url: string;
};

export type SentenceTiming = {
  index: number;
  text: string;
  startSeconds: number;
  endSeconds: number;
};
