export type TimelineScene = {
  index: number;
  text: string;
  imageSrc?: string; // path relative to Remotion publicDir (used via staticFile)
  videoSrc?: string; // optional video for this scene (relative to publicDir, used via staticFile)
  startFrame: number;
  durationFrames: number;
  useGlitch?: boolean; // Apply glitch transition effect
};

export type Timeline = {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  audioSrc: string; // path relative to Remotion publicDir (used via staticFile)
  scenes: TimelineScene[];
  // Optional render/transition configuration from the backend
  enableGlitchTransitions?: boolean;
  enableZoomRotateTransitions?: boolean;
};


