import type { SentenceInput, SentenceTiming } from './render-videos.types';
import {
  SUBSCRIBE_SENTENCE,
  CHROMA_LEAK_SFX_CLOUDINARY_URL,
  GLITCH_FX_CLOUDINARY_URL,
  WHOOSH_CLOUDINARY_URL,
  CAMERA_CLICK_CLOUDINARY_URL,
} from './render-videos.constants';

export const isShortScript = (scriptLength: string) => {
  const s = String(scriptLength ?? '').trim().toLowerCase();
  if (!s) return false;

  const secondsMatch = /([0-9]+(?:\.[0-9]+)?)\s*second/u.exec(s);
  if (secondsMatch?.[1]) {
    const seconds = Number(secondsMatch[1]);
    if (!Number.isFinite(seconds)) return false;
    return seconds / 60 <= 3;
  }

  const minutesMatch = /([0-9]+(?:\.[0-9]+)?)\s*minute/u.exec(s);
  if (minutesMatch?.[1]) {
    const minutes = Number(minutesMatch[1]);
    if (!Number.isFinite(minutes)) return false;
    return minutes <= 3;
  }

  // Fallback: preserve legacy behavior for unexpected strings.
  return s.startsWith('30');
};

export const buildTimeline = (params: {
  sentences: SentenceInput[];
  imagePaths: string[];
  scriptLength: string;
  audioDurationSeconds: number;
  audioSrc: string;
  sentenceTimings?: SentenceTiming[];
  subscribeVideoSrc?: string | null;
  isShort?: boolean;
  useLowerFps?: boolean;
  useLowerResolution?: boolean;
  addSubtitles?: boolean;
  enableGlitchTransitions?: boolean;
  backgroundMusicSrc?: string | null;
  backgroundMusicVolume?: number;
  useRemoteAssets?: boolean;
}) => {
  const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

  const backgroundMusicVolume =
    typeof params.backgroundMusicVolume === 'number' &&
    Number.isFinite(params.backgroundMusicVolume)
      ? clamp01(params.backgroundMusicVolume)
      : 1;

  const baseFps = 30;
  const fps = params.useLowerFps ? 24 : baseFps;
  const isShort =
    typeof params.isShort === 'boolean'
      ? params.isShort
      : isShortScript(params.scriptLength);
  const width = isShort
    ? params.useLowerResolution
      ? 720
      : 1080
    : params.useLowerResolution
      ? 1280
      : 1920;
  const height = isShort
    ? params.useLowerResolution
      ? 1280
      : 1920
    : params.useLowerResolution
      ? 720
      : 1080;

  const T = Math.max(1, params.audioDurationSeconds || 1);
  const N = Math.max(1, params.sentences.length || 1);
  const glitchSceneIndex = params.enableGlitchTransitions
    ? Math.floor(N / 2)
    : -1;

  const nominalEndFrames: number[] = params.sentences.map((s, index) => {
    const timing = params.sentenceTimings?.[index];
    const nextTiming =
      index + 1 < N ? params.sentenceTimings?.[index + 1] : undefined;

    const startSeconds =
      timing && typeof timing.startSeconds === 'number'
        ? Math.max(0, Math.min(timing.startSeconds, T))
        : (T * index) / N;

    const rawEndSeconds =
      timing && typeof timing.endSeconds === 'number'
        ? timing.endSeconds
        : nextTiming && typeof nextTiming.startSeconds === 'number'
          ? nextTiming.startSeconds
          : (T * (index + 1)) / N;

    const endSeconds = Math.max(
      startSeconds + 1 / fps,
      Math.min(Math.max(0, rawEndSeconds), T),
    );

    // Use ceil for the end to avoid truncating away the last visible frame.
    return Math.ceil(endSeconds * fps);
  });

  let cursor = 0;
  const scenes = params.sentences.map((s, index) => {
    const isSubscribe =
      (s.text || '').trim() === SUBSCRIBE_SENTENCE &&
      !!params.subscribeVideoSrc;

    const wantsSentenceVideo =
      !isSubscribe &&
      s.mediaType === 'video' &&
      !!String(s.videoUrl ?? '').trim();

    // Critical: ensure scenes are frame-contiguous.
    // Any gap from rounding would otherwise show as black in Remotion.
    const startFrame = index === 0 ? 0 : cursor;
    const endFrame = Math.max(
      startFrame + 1,
      nominalEndFrames[index] ?? startFrame + 1,
    );
    const durationFrames = endFrame - startFrame;
    cursor = endFrame;

    return {
      index,
      text: s.text,
      isSuspense: !!s.isSuspense,
      ...(s.visualEffect != null ? { visualEffect: s.visualEffect } : {}),
      imageSrc:
        isSubscribe || wantsSentenceVideo
          ? undefined
          : params.imagePaths[index],
      videoSrc: isSubscribe
        ? params.subscribeVideoSrc
        : wantsSentenceVideo
          ? String(s.videoUrl)
          : undefined,
      startFrame,
      ...(s.transitionToNext != null
        ? { transitionToNext: s.transitionToNext }
        : {}),
      durationFrames,
      useGlitch: index === glitchSceneIndex,
    };
  });

  const durationInFrames =
    scenes.length > 0
      ? scenes[scenes.length - 1].startFrame +
        scenes[scenes.length - 1].durationFrames
      : Math.ceil(T * fps);

  const useRemoteAssets = params.useRemoteAssets === true;

  // Only include `assets` overrides when needed.
  // - In local renders, prefer Remotion's `staticFile()` defaults from `remotion/public/*`.
  // - In Lambda/serverless renders, remote CDN URLs may be preferred for performance.
  const assets: {
    backgroundMusicSrc?: string | null;
    backgroundMusicVolume?: number;
    glitchSfxSrc?: string;
    whooshSfxSrc?: string;
    cameraClickSfxSrc?: string;
    chromaLeakSfxSrc?: string;
    suspenseGlitchSfxSrc?: string;
  } = {};

  if (typeof params.backgroundMusicSrc !== 'undefined') {
    assets.backgroundMusicSrc = params.backgroundMusicSrc;
  }

  if (
    typeof params.backgroundMusicVolume === 'number' &&
    Number.isFinite(params.backgroundMusicVolume)
  ) {
    assets.backgroundMusicVolume = backgroundMusicVolume;
  }

  if (useRemoteAssets) {
    assets.chromaLeakSfxSrc = CHROMA_LEAK_SFX_CLOUDINARY_URL;
    assets.glitchSfxSrc = GLITCH_FX_CLOUDINARY_URL;
    assets.whooshSfxSrc = WHOOSH_CLOUDINARY_URL;
    assets.cameraClickSfxSrc = CAMERA_CLICK_CLOUDINARY_URL;
    // Leave unset (or empty) to let the composition fall back to local `staticFile()`.
    assets.suspenseGlitchSfxSrc = '';
  }

  return {
    width,
    height,
    fps,
    durationInFrames,
    audioSrc: params.audioSrc,
    addSubtitles: params.addSubtitles,
    assets: Object.keys(assets).length > 0 ? assets : undefined,
    scenes,
  };
};
