export type TimelineScene = {
  index: number;
  text: string;
  imageSrc?: string; // static file path (publicDir) or absolute URL
  videoSrc?: string; // static file path (publicDir) or absolute URL
  startFrame: number;
  durationFrames: number;
  useGlitch?: boolean; // Apply glitch transition effect
  isSuspense?: boolean;
};

export type Timeline = {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  audioSrc: string; // static file path (publicDir) or absolute URL
  scenes: TimelineScene[];
  // Optional asset URLs for production renders (CDN/Cloudinary/S3). If omitted,
  // the composition falls back to local `staticFile()` assets.
  assets?: {
    backgroundMusicSrc?: string;
    glitchSfxSrc?: string;
    whooshSfxSrc?: string;
    cameraClickSfxSrc?: string;
    chromaLeakSfxSrc?: string;
    suspenseGlitchSfxSrc?: string;
    subscribeVideoSrc?: string;
  };
  // Optional render/transition configuration from the backend
  enableGlitchTransitions?: boolean;
  enableZoomRotateTransitions?: boolean;
};


