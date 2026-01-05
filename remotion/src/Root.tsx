import React from 'react';
import { Composition } from 'remotion';
import { AutoVideo } from './AutoVideo';
import type { Timeline } from './types';

const defaultTimeline: Timeline = {
  width: 1080,
  height: 1920,
  fps: 25,
  durationInFrames: 25,
  audioSrc: '',
  scenes: [],
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="AutoVideo"
        component={AutoVideo}
        durationInFrames={defaultTimeline.durationInFrames}
        fps={defaultTimeline.fps}
        width={defaultTimeline.width}
        height={defaultTimeline.height}
        defaultProps={{ timeline: defaultTimeline }}
      />
    </>
  );
};


