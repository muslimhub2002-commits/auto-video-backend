import { staticFile } from 'remotion';

const normalizeStaticAssetSrc = (src: string) => {
  const normalized = src.replace(/^\/+/, '');

  if (
    normalized === 'videos/subscribe.mp4' ||
    normalized === 'subscribe.mp4'
  ) {
    return 'subscribe.mp4';
  }

  return normalized;
};

export const preloadImage = (src: string) =>
  new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = src;
  });

export const preloadAudio = (src: string) =>
  new Promise<void>((resolve) => {
    const audio = document.createElement('audio');
    const done = () => resolve();
    audio.preload = 'auto';
    audio.oncanplaythrough = done;
    audio.onloadedmetadata = done;
    audio.onerror = done;
    audio.src = src;
    // Some browsers require calling load() to start fetching.
    audio.load();
  });

export const preloadVideo = (src: string) =>
  new Promise<void>((resolve) => {
    const video = document.createElement('video');
    const done = () => resolve();
    video.preload = 'auto';
    video.onloadeddata = done;
    video.onloadedmetadata = done;
    video.onerror = done;
    video.src = src;
    video.load();
  });

export const getVideoDurationSeconds = (src: string) =>
  new Promise<number | null>((resolve) => {
    const video = document.createElement('video');
    const done = (value: number | null) => resolve(value);
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = Number(video.duration);
      done(Number.isFinite(duration) && duration > 0 ? duration : null);
    };
    video.onerror = () => done(null);
    video.src = src;
    video.load();
  });

export type MediaKind = 'audio' | 'video' | 'image';

export const guessMediaKind = (src: string): MediaKind => {
  const lower = src.toLowerCase();
  if (lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.m4a')) {
    return 'audio';
  }
  if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov')) {
    return 'video';
  }
  return 'image';
};

export const preloadMedia = async (src: string) => {
  const kind = guessMediaKind(src);
  if (kind === 'audio') return preloadAudio(src);
  if (kind === 'video') return preloadVideo(src);
  return preloadImage(src);
};

export const resolveMediaSrc = (src: string) => {
  if (!src) return src;
  // If we already have an absolute URL (e.g. Cloudinary), use it as-is.
  if (/^https?:\/\//i.test(src)) return src;
  return staticFile(normalizeStaticAssetSrc(src));
};
