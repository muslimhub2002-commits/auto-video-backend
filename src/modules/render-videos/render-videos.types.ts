export type SentenceInput = {
  text: string;
  isSuspense?: boolean;
  mediaType?: 'image' | 'video';
  videoUrl?: string;
  soundEffects?: Array<{
    // Absolute URL (e.g. Cloudinary) or static publicDir path (job-scoped) for local renders.
    src: string;
    delaySeconds?: number;
    // 0..300 where 100 = normal volume. Optional.
    volumePercent?: number;
  }>;
  transitionToNext?:
    | 'none'
    | 'glitch'
    | 'whip'
    | 'flash'
    | 'fade'
    | 'chromaLeak'
    | null;
  visualEffect?:
    | 'none'
    | 'colorGrading'
    | 'animatedLighting'
    | 'glassSubtle'
    | 'glassReflections'
    | 'glassStrong'
    | null;
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
