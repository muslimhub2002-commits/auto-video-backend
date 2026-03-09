export type TimelineScene = {
  index: number;
  text: string;
  imageEffectsMode?: 'quick' | 'detailed' | null;
  imageFilterId?: string | null;
  imageFilterSettings?: Record<string, unknown> | null;
  motionEffectId?: string | null;
  imageMotionSettings?: Record<string, unknown> | null;
  imageSrc?: string; // static file path (publicDir) or absolute URL
  videoSrc?: string; // static file path (publicDir) or absolute URL
  soundEffects?: Array<{
    src: string; // static file path (publicDir) or absolute URL
    delaySeconds?: number;
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
  };
  // Optional render/transition configuration from the backend
  enableGlitchTransitions?: boolean;
  enableZoomRotateTransitions?: boolean;
};


