import React from 'react';
import {
  AbsoluteFill,
  Html5Audio,
  Img,
  OffthreadVideo,
  Sequence,
  Video,
  interpolate,
  random,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import type { Timeline, TimelineScene } from './types';

const Scene: React.FC<{ scene: TimelineScene; fontScale: number; prevSceneImage?: string; isLastScene: boolean; nextSceneHasGlitch: boolean }> = ({ scene, fontScale, prevSceneImage, isLastScene, nextSceneHasGlitch }) => {
  const frame = useCurrentFrame();
  const totalFrames = scene.durationFrames;

  // Glitch effect parameters (only active if useGlitch is true)
  const glitchDuration = Math.min(8, Math.floor(totalFrames / 4));
  const isGlitching = scene.useGlitch && frame < glitchDuration;
  
  // For glitch: hard cut from previous to current at midpoint of glitch
  const glitchCutFrame = Math.floor(glitchDuration / 2);
  const showPrevImage = scene.useGlitch && frame < glitchCutFrame && prevSceneImage;
  
  // Glitch intensity peaks at the cut point and fades out
  const glitchIntensity = isGlitching
    ? interpolate(
        frame,
        [0, glitchCutFrame, glitchDuration],
        [0, 15, 0],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
      )
    : 0;

  // Cross-fade / fade transition length for non-glitch scenes (shorter for snappier cuts)
  const crossFadeDuration = Math.max(16, Math.min(8, Math.floor(totalFrames / 6)));

  // Decide per-scene transition style (fade vs cross-fade) deterministically
  const transitionSeed = scene.index + (isLastScene ? 1000 : 0);
  const useCrossFade = !scene.useGlitch && !nextSceneHasGlitch
    ? random(`scene-transition-${transitionSeed}`) < 0.5
    : true;

  // Background opacity logic:
  // - Glitch scenes: stay fully visible (no fade in/out).
  // - Scenes before a glitch: fade in only (glitch handles the transition).
  // - Other non-glitch scenes: randomly use cross-fade (in+out) or simple fade (in only).
  const backgroundOpacity = scene.useGlitch
    ? 1
    : nextSceneHasGlitch
      ? interpolate(
          frame,
          [0, crossFadeDuration],
          [0, 1],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
        )
      : useCrossFade
        ? interpolate(
            frame,
            [0, crossFadeDuration, totalFrames - crossFadeDuration, totalFrames],
            [0, 1, 1, 0],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          )
        : (() => {
            // Regular fade: quick fade-in, then stay fully visible,
            // and only fade to black in a very short window at the end.
            const fadeOutDuration = Math.max(16, Math.floor(crossFadeDuration / 2));
            const fadeOutStart = Math.max(crossFadeDuration, totalFrames - fadeOutDuration);
            return interpolate(
              frame,
              [0, crossFadeDuration, fadeOutStart, totalFrames],
              [0, 1, 1, 0],
              { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
            );
          })();

  // Text fades in at start and out at end
  const textFadeDuration = Math.min(12, Math.floor(totalFrames / 4));
  const textOpacity = interpolate(
    frame,
    [0, textFadeDuration, totalFrames - textFadeDuration, totalFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // Subtle Ken Burns zoom for cinematic feel
  // If this is a glitch scene showing previous image, start from the previous scene's final zoom (1.10)
  const zoomStartScale = scene.useGlitch && showPrevImage ? 1.10 : 1.0;
  // Adjust zoom amount based on scene duration: shorter scenes get more zoom,
  // longer scenes get a more subtle (or almost no) zoom so the motion
  // doesnt feel too strong over a long hold.
  const baseZoomDelta = 0.10;
  const durationFactor = Math.min(1, 60 / Math.max(totalFrames, 1));
  const zoomDelta = baseZoomDelta * durationFactor;
  const zoomScale = interpolate(
    frame,
    [0, totalFrames],
    [zoomStartScale, zoomStartScale + zoomDelta],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const backgroundStyle: React.CSSProperties = {
    transform: `scale(${zoomScale})`,
    transformOrigin: 'center center',
    opacity: backgroundOpacity,
  };

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {scene.useGlitch && (
        <Html5Audio src={staticFile('glitch-fx.mp3')} volume={0.4} />
      )}
      {scene.videoSrc ? (
        <AbsoluteFill style={backgroundStyle}>
          <OffthreadVideo
            src={staticFile(scene.videoSrc)}
            muted
            pauseWhenBuffering
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </AbsoluteFill>
      ) : (
        scene.imageSrc && (
          <>
            {/* Show previous or current image based on glitch cut point */}
            <AbsoluteFill style={backgroundStyle}>
              <Img
                src={staticFile(showPrevImage ? prevSceneImage : scene.imageSrc)}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </AbsoluteFill>
            {/* Glitch RGB channel separation layers */}
            {isGlitching && (
              <>
                <AbsoluteFill
                  style={{
                    transform: `scale(${zoomScale}) translateX(${glitchIntensity}px)`,
                    transformOrigin: 'center center',
                    mixBlendMode: 'screen',
                    opacity: 0.85,
                  }}
                >
                  <Img
                    src={staticFile(showPrevImage ? prevSceneImage : scene.imageSrc)}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      filter: 'brightness(1.4) sepia(0.5) hue-rotate(330deg)',
                    }}
                  />
                </AbsoluteFill>
                <AbsoluteFill
                  style={{
                    transform: `scale(${zoomScale}) translateX(${-glitchIntensity}px)`,
                    transformOrigin: 'center center',
                    mixBlendMode: 'screen',
                    opacity: 0.85,
                  }}
                >
                  <Img
                    src={staticFile(showPrevImage ? prevSceneImage : scene.imageSrc)}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      filter: 'brightness(1.4) sepia(0.5) hue-rotate(180deg)',
                    }}
                  />
                </AbsoluteFill>
              </>
            )}
          </>
        )
      )}
      <AbsoluteFill
        style={{
          justifyContent: 'flex-end',
          padding: 48,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            maxWidth: 980,
            alignSelf: 'center',
            // background: 'rgba(0,0,0,0.55)',
            color: 'white',
            padding: '18px 22px',
            borderRadius: 18,
            fontSize: 55 * fontScale,
            fontWeight: 700,
            fontFamily: 'Oswald, system-ui, sans-serif',
            lineHeight: 1.15,
            marginBottom: '125px',
            textAlign: 'center',
            textShadow: '0 2px 10px rgba(0,0,0,0.55)',
            opacity: textOpacity,
          }}
        >
          {scene.text}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const AutoVideo: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const isVertical = timeline.height > timeline.width;
  const baseHeight = isVertical ? 1920 : 1080;
  const fontScale = Math.max(0.5, Math.min(1, timeline.height / baseHeight));

  return (
    <AbsoluteFill>
      {timeline.audioSrc && (
        <Html5Audio src={staticFile(timeline.audioSrc)} />
      )}
      {/* Global background music from remotion/public, trimmed to video length by the composition */}
      <Html5Audio src={staticFile('background.mp3')}/>
      {timeline.scenes.map((scene, idx) => {
        const prevScene = idx > 0 ? timeline.scenes[idx - 1] : null;
        const nextScene = idx < timeline.scenes.length - 1 ? timeline.scenes[idx + 1] : null;
        const isLastScene = idx === timeline.scenes.length - 1;
        const nextSceneHasGlitch = nextScene?.useGlitch ?? false;
        return (
          <Sequence
            key={scene.index}
            from={scene.startFrame}
            durationInFrames={scene.durationFrames}
          >
            <Scene scene={scene} fontScale={fontScale} prevSceneImage={prevScene?.imageSrc} isLastScene={isLastScene} nextSceneHasGlitch={nextSceneHasGlitch} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};


