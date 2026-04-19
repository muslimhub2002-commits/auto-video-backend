export const TEXT_ANIMATION_EFFECT_VALUES = ['slideCutFast'] as const;

export const TEXT_BACKGROUND_MODE_VALUES = [
  'inheritImage',
  'image',
  'inheritVideo',
  'video',
  'solid',
  'gradient',
] as const;

export const OVERLAY_BACKGROUND_MODE_VALUES = [
  'image',
  'video',
  'solid',
  'gradient',
] as const;

export const OVERLAY_TEXT_LAYER_VALUES = ['below', 'above'] as const;

export type TextAnimationEffect = (typeof TEXT_ANIMATION_EFFECT_VALUES)[number];
export type TextBackgroundMode = (typeof TEXT_BACKGROUND_MODE_VALUES)[number];
export type OverlayBackgroundMode =
  (typeof OVERLAY_BACKGROUND_MODE_VALUES)[number];
export type OverlayTextLayer = (typeof OVERLAY_TEXT_LAYER_VALUES)[number];

export type TextAnimationSettings = {
  presetKey?: TextAnimationEffect | 'custom';
  speed?: number;
  horizontalAlign?: 'left' | 'center' | 'right';
  contentAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  offsetX?: number;
  offsetY?: number;
  fontSizePercent?: number;
  maxWidthPercent?: number;
  fontWeight?: number;
  letterSpacingEm?: number;
  lineHeight?: number;
  textColor?: string;
  accentColor?: string;
  strokeColor?: string;
  strokeWidthPx?: number;
  shadowOpacity?: number;
  shadowBlurPx?: number;
  backgroundMode?: TextBackgroundMode;
  backgroundColor?: string;
  gradientFrom?: string;
  gradientTo?: string;
  gradientAngleDeg?: number;
  backgroundDim?: number;
  animationIntensity?: number;
  startDelaySeconds?: number;
  animatePerWord?: boolean;
  wordDelaySeconds?: number;
  textCase?: 'original' | 'uppercase';
};

export type OverlaySettings = {
  presetKey?: 'custom';
  backgroundMode?: OverlayBackgroundMode;
  widthPercent?: number;
  heightPercent?: number;
  offsetX?: number;
  offsetY?: number;
  opacity?: number;
  speed?: number;
  scale?: number;
  rotationDeg?: number;
  backgroundColor?: string;
  gradientFrom?: string;
  gradientTo?: string;
  gradientAngleDeg?: number;
  startDelaySeconds?: number;
  includeText?: boolean;
  textLayer?: OverlayTextLayer;
};

export type SentenceInput = {
  text: string;
  isSuspense?: boolean;
  secondaryImageUrl?: string;
  imageEffectsMode?: 'quick' | 'detailed' | null;
  imageFilterId?: string | null;
  imageFilterSettings?: Record<string, unknown> | null;
  motionEffectId?: string | null;
  imageMotionSettings?: Record<string, unknown> | null;
  soundEffectsAlignToSceneEnd?: boolean;
  mediaType?: 'image' | 'video' | 'text' | 'overlay';
  videoUrl?: string;
  textBackgroundVideoUrl?: string;
  textAnimationEffect?: TextAnimationEffect | null;
  textAnimationText?: string;
  textAnimationSettings?:
    | Record<string, unknown>
    | TextAnimationSettings
    | null;
  overlayUrl?: string;
  overlayMimeType?: string | null;
  overlaySettings?: Record<string, unknown> | OverlaySettings | null;
  soundEffects?: Array<{
    // Absolute URL (e.g. Cloudinary) or static publicDir path (job-scoped) for local renders.
    src: string;
    delaySeconds?: number;
    trimStartSeconds?: number;
    durationSeconds?: number;
    // 0..300 where 100 = normal volume. Optional.
    volumePercent?: number;
  }>;
  transitionSoundEffects?: Array<{
    src: string;
    delaySeconds?: number;
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
  imageMotionEffect?:
    | 'default'
    | 'slowZoomIn'
    | 'slowZoomOut'
    | 'diagonalDrift'
    | 'cinematicPan'
    | 'focusShift'
    | 'parallaxMotion'
    | 'shakeMicroMotion'
    | 'splitMotion'
    | 'rotationDrift'
    | null;
  imageMotionSpeed?: number | null;
};

export type UploadedAsset = {
  buffer: Buffer;
  originalName: string;
  mimeType?: string;
};

export type UrlAsset = {
  url: string;
};

export type WordTiming = {
  text: string;
  startSeconds: number;
  endSeconds: number;
  confidence?: number;
};

export type SentenceTiming = {
  index: number;
  text: string;
  startSeconds: number;
  endSeconds: number;
  words?: WordTiming[];
};

export const resolveTextSceneBackgroundMode = (
  settings: SentenceInput['textAnimationSettings'],
): TextBackgroundMode => {
  const value = String(
    (settings as TextAnimationSettings | null | undefined)?.backgroundMode ??
      '',
  ).trim();
  return (TEXT_BACKGROUND_MODE_VALUES as readonly string[]).includes(value)
    ? (value as TextBackgroundMode)
    : 'inheritImage';
};

export const resolveOverlaySceneBackgroundMode = (
  settings: SentenceInput['overlaySettings'],
): OverlayBackgroundMode => {
  const value = String(
    (settings as OverlaySettings | null | undefined)?.backgroundMode ?? '',
  ).trim();
  return (OVERLAY_BACKGROUND_MODE_VALUES as readonly string[]).includes(value)
    ? (value as OverlayBackgroundMode)
    : 'image';
};

export const sentenceUsesPrimaryImageTransport = (
  sentence:
    | Pick<
        SentenceInput,
        'mediaType' | 'textAnimationSettings' | 'overlaySettings'
      >
    | null
    | undefined,
) => {
  if (sentence?.mediaType === 'video') return false;
  if (sentence?.mediaType === 'text') {
    const backgroundMode = resolveTextSceneBackgroundMode(
      sentence.textAnimationSettings,
    );
    return backgroundMode === 'inheritImage' || backgroundMode === 'image';
  }
  if (sentence?.mediaType === 'overlay') {
    const backgroundMode = resolveOverlaySceneBackgroundMode(
      sentence.overlaySettings,
    );
    return backgroundMode === 'image';
  }

  return true;
};
