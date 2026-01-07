export type TimelineScene = {
  index: number;
  text: string;
  imageSrc?: string; // static file path (publicDir) or absolute URL
  videoSrc?: string; // static file path (publicDir) or absolute URL
  startFrame: number;
  durationFrames: number;
  useGlitch?: boolean; // Apply glitch transition effect
};

export type Timeline = {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  audioSrc: string; // static file path (publicDir) or absolute URL
  scenes: TimelineScene[];
  // Optional render/transition configuration from the backend
  enableGlitchTransitions?: boolean;
  enableZoomRotateTransitions?: boolean;
};


