export type TextAnimationEffect =
  | 'slideCutFast';

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
  backgroundMode?:
    | 'inheritImage'
    | 'image'
    | 'inheritVideo'
    | 'video'
    | 'solid'
    | 'gradient';
  backgroundColor?: string;
  gradientFrom?: string;
  gradientTo?: string;
  gradientAngleDeg?: number;
  backgroundDim?: number;
  animationIntensity?: number;
  animatePerWord?: boolean;
  wordDelaySeconds?: number;
  textCase?: 'original' | 'uppercase';
};

export type OverlaySettings = {
  presetKey?: 'custom';
  backgroundMode?: 'image' | 'video' | 'solid' | 'gradient';
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
  includeText?: boolean;
  textLayer?: 'below' | 'above';
};

export type TimelineScene = {
  index: number;
  text: string;
  mediaType?: 'image' | 'video' | 'text' | 'overlay';
  subtitleWords?: Array<{
    text: string;
    startFrame: number;
    endFrame: number;
    confidence?: number;
  }>;
  imageEffectsMode?: 'quick' | 'detailed' | null;
  imageFilterId?: string | null;
  imageFilterSettings?: Record<string, unknown> | null;
  motionEffectId?: string | null;
  imageMotionSettings?: Record<string, unknown> | null;
  imageSrc?: string; // static file path (publicDir) or absolute URL
  secondaryImageSrc?: string;
  videoSrc?: string; // static file path (publicDir) or absolute URL
  textBackgroundVideoSrc?: string;
  overlaySrc?: string;
  overlayMimeType?: string | null;
  overlaySettings?: OverlaySettings | Record<string, unknown> | null;
  overlayBackgroundVideoSrc?: string;
  soundEffects?: Array<{
    src: string; // static file path (publicDir) or absolute URL
    delaySeconds?: number;
    trimStartSeconds?: number;
    durationSeconds?: number;
    // Remotion Audio volume multiplier. 1 = normal volume.
    volume?: number;
  }>;
  transitionSoundEffects?: Array<{
    src: string;
    delaySeconds?: number;
    volume?: number;
  }>;
  transitionToNext?: 'none' | 'glitch' | 'whip' | 'flash' | 'fade' | 'chromaLeak' | null;
  visualEffect?:
    | 'none'
    | 'colorGrading'
    | 'animatedLighting'
    | 'glassSubtle'
    | 'glassReflections'
    | 'glassStrong'
    | null;
  textAnimationEffect?: TextAnimationEffect | null;
  textAnimationText?: string;
  textAnimationSettings?: TextAnimationSettings | Record<string, unknown> | null;
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
  startFrame: number;
  durationFrames: number;
  useGlitch?: boolean; // Apply glitch transition effect
  isSuspense?: boolean;
};

export type Timeline = {
  language?: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  audioSrc: string; // static file path (publicDir) or absolute URL
  addSubtitles?: boolean;
  scenes: TimelineScene[];
  // Optional asset URLs for production renders (CDN/Cloudinary/S3). If omitted,
  // the composition falls back to local `staticFile()` assets.
  assets?: {
    backgroundMusicSrc?: string | null;
    backgroundMusicVolume?: number;
    glitchSfxSrc?: string;
    whooshSfxSrc?: string;
    cameraClickSfxSrc?: string;
    chromaLeakSfxSrc?: string | null;
    suspenseGlitchSfxSrc?: string;
    subscribeVideoSrc?: string;
    recurringSubscribeOverlay?: {
      videoSrc: string;
      intervalSeconds: number;
      durationSeconds: number;
      position: 'topLeft';
    };
  };
  // Optional render/transition configuration from the backend
  enableGlitchTransitions?: boolean;
  enableZoomRotateTransitions?: boolean;
};


