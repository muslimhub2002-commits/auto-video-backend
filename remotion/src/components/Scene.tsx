import React from 'react';
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  Easing,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { TimelineScene } from '../types';
import {
  CHROMA_EDGE_FRAMES,
  CHROMA_MAX_BLUR_PX,
  CHROMA_MAX_SHIFT_PX,
  FADE_EDGE_FRAMES,
  FLASH_EDGE_FRAMES,
  IMAGE_ZOOM_PER_SECOND,
  WHIP_DISTANCE_MULTIPLIER,
  WHIP_EDGE_FRAMES,
  WHIP_MAX_BLUR_PX,
} from '../constants';
import { resolveMediaSrc } from '../utils/media';
import { clamp01, mulberry32 } from '../utils/random';
import type { TransitionType } from '../utils/transitions';
import { getChromaParams } from '../utils/transitions';
import { GlitchImage } from './GlitchImage';
import { SuspenseOverlay } from './SuspenseOverlay';

export const Scene: React.FC<{
  scene: TimelineScene;
  fontScale: number;
  showSubtitles: boolean;
  transitionFromPrev: TransitionType;
  transitionToNext: TransitionType;
  seedFromPrev: number;
  seedToNext: number;
  whipDirFromPrev: number;
  whipDirToNext: number;
}> = React.memo(
  ({
    scene,
    fontScale,
    showSubtitles,
    transitionFromPrev,
    transitionToNext,
    seedFromPrev,
    seedToNext,
    whipDirFromPrev,
    whipDirToNext,
  }) => {
    const frame = useCurrentFrame();
    const { fps, width, height } = useVideoConfig();
    const isShort = height > width;

    // Inside a <Sequence>, useCurrentFrame() is already relative to the Sequence start.
    // Clamp to 0 to ensure each scene starts at default scale.
    const elapsedSeconds = Math.max(0, frame) / fps;

    const isSuspenseOpening = scene.index === 0 && Boolean(scene.isSuspense);
    const suspenseFilter = isSuspenseOpening
      ? 'grayscale(1) contrast(1.38) brightness(0.88)'
      : undefined;

    const visualEffect = scene.visualEffect ?? null;

    const colorGradingFilter =
      visualEffect === 'colorGrading'
        ? 'contrast(1.12) saturate(1.16) brightness(0.98)'
        : undefined;

    const wrapperFilter = [suspenseFilter, colorGradingFilter].filter(Boolean).join(' ') || undefined;

    // Subtle film flicker for the suspense opening.
    const suspenseFlicker = isSuspenseOpening
      ? 0.02 + 0.02 * Math.sin(frame * 0.9) + 0.012 * Math.sin(frame * 2.7)
      : 0;

    // Occasional scratch "pop" (deterministic) to mimic film damage.
    const scratchRand = mulberry32((scene.index + 1) * 881 + frame * 131)();
    const scratchPulse = isSuspenseOpening
      ? clamp01((scratchRand - 0.92) * 16)
      : 0;
    const scratchAlpha = isSuspenseOpening
      ? clamp01(0.14 + suspenseFlicker + 0.62 * scratchPulse)
      : 0;

    // Vertical line glitch pulses (deterministic).
    const vRand = mulberry32((scene.index + 1) * 1907 + frame * 73)();
    const softPulse = isSuspenseOpening ? clamp01((vRand - 0.70) * 3.2) : 0;
    const hardPulse = isSuspenseOpening ? clamp01((vRand - 0.92) * 22) : 0;
    const verticalGlitchAlpha = isSuspenseOpening
      ? clamp01(
          0.16 +
            0.18 * suspenseFlicker +
            0.42 * softPulse +
            0.55 * hardPulse +
            0.20 * scratchPulse,
        )
      : 0;

    // Overlay-only jitter during hard pulses.
    const jitterSeed = (scene.index + 1) * 7129 + frame * 11;
    const jitterX = isSuspenseOpening
      ? (mulberry32(jitterSeed)() * 2 - 1) * 10 * hardPulse
      : 0;

    // Wide "tear band" parameters.
    const bandSeed = (scene.index + 1) * 9029 + Math.floor(frame / 2) * 37;
    const bandX = Math.round(mulberry32(bandSeed)() * (width - 40));
    const bandW = Math.round(18 + mulberry32(bandSeed ^ 0x9e3779b9)() * 72);
    const bandOn = isSuspenseOpening && hardPulse > 0.08;

    // Bright “splice” line.
    const spliceOn = isSuspenseOpening && (hardPulse > 0.35 || scratchPulse > 0.7);
    const spliceXSeed = (scene.index + 1) * 3331 + Math.floor(frame / 3) * 97;
    const spliceX = Math.round(mulberry32(spliceXSeed)() * (width - 6));

    // Base media layer.
    const backgroundStyle: React.CSSProperties = {
      transform: 'none',
      opacity: 1,
    };

    const imageStyle: React.CSSProperties = {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      transformOrigin: 'center center',
    };

    // Whip-pan.
    const whipEasing = Easing.inOut(Easing.cubic);
    const panDistance = width * WHIP_DISTANCE_MULTIPLIER;

    const hasWhipIn = transitionFromPrev === 'whip' && frame < WHIP_EDGE_FRAMES;
    const hasWhipOut =
      transitionToNext === 'whip' && frame >= scene.durationFrames - WHIP_EDGE_FRAMES;

    const xIn = hasWhipIn
      ? interpolate(frame, [0, WHIP_EDGE_FRAMES], [-whipDirFromPrev * panDistance, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: whipEasing,
        })
      : 0;
    const xOut = hasWhipOut
      ? interpolate(
          frame,
          [scene.durationFrames - WHIP_EDGE_FRAMES, scene.durationFrames],
          [0, whipDirToNext * panDistance],
          {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: whipEasing,
          },
        )
      : 0;
    const whipX = xIn + xOut;

    const blurIn = hasWhipIn
      ? interpolate(frame, [0, WHIP_EDGE_FRAMES], [WHIP_MAX_BLUR_PX, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: whipEasing,
        })
      : 0;
    const blurOut = hasWhipOut
      ? interpolate(
          frame,
          [scene.durationFrames - WHIP_EDGE_FRAMES, scene.durationFrames],
          [0, WHIP_MAX_BLUR_PX],
          {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: whipEasing,
          },
        )
      : 0;
    const whipBlur = Math.min(WHIP_MAX_BLUR_PX, blurIn + blurOut);

    const baseScale = 1 + IMAGE_ZOOM_PER_SECOND * elapsedSeconds;
    const whipSkew = (whipBlur / WHIP_MAX_BLUR_PX) * 6 * (whipX >= 0 ? 1 : -1);

    imageStyle.transform = `translateX(${whipX.toFixed(2)}px) skewX(${whipSkew.toFixed(
      2,
    )}deg) scale(${baseScale.toFixed(6)})`;
    imageStyle.willChange = 'transform, filter';
    imageStyle.filter =
      whipBlur > 0.01
        ? `blur(${whipBlur.toFixed(2)}px) contrast(1.08) saturate(1.04)`
        : undefined;

    // Camera flash.
    const hasFlashIn = transitionFromPrev === 'flash' && frame < FLASH_EDGE_FRAMES;
    const hasFlashOut =
      transitionToNext === 'flash' && frame >= scene.durationFrames - FLASH_EDGE_FRAMES;

    const flashDecayEasing = Easing.out(Easing.cubic);
    const flashRiseEasing = Easing.in(Easing.cubic);

    const flashInAlpha = hasFlashIn
      ? interpolate(frame, [0, FLASH_EDGE_FRAMES - 1], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: flashDecayEasing,
        })
      : 0;

    const flashOutAlpha = hasFlashOut
      ? interpolate(
          frame,
          [scene.durationFrames - FLASH_EDGE_FRAMES, scene.durationFrames - 1],
          [0, 1],
          {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: flashRiseEasing,
          },
        )
      : 0;

    const flashAlpha = Math.max(flashInAlpha, flashOutAlpha);

    // Fade-to-black.
    const hasFadeIn = transitionFromPrev === 'fade' && frame < FADE_EDGE_FRAMES;
    const hasFadeOut =
      transitionToNext === 'fade' && frame >= scene.durationFrames - FADE_EDGE_FRAMES;

    const fadeInAlpha = hasFadeIn
      ? interpolate(frame, [0, FADE_EDGE_FRAMES - 1], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: Easing.out(Easing.cubic),
        })
      : 0;

    const fadeOutAlpha = hasFadeOut
      ? interpolate(
          frame,
          [scene.durationFrames - FADE_EDGE_FRAMES, scene.durationFrames - 1],
          [0, 1],
          {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.in(Easing.cubic),
          },
        )
      : 0;

    const fadeAlpha = Math.max(fadeInAlpha, fadeOutAlpha);

    // Chroma leak.
    const hasChromaIn =
      transitionFromPrev === 'chromaLeak' && frame < CHROMA_EDGE_FRAMES;
    const hasChromaOut =
      transitionToNext === 'chromaLeak' &&
      frame >= scene.durationFrames - CHROMA_EDGE_FRAMES;

    const chromaInAlpha = hasChromaIn
      ? interpolate(frame, [0, CHROMA_EDGE_FRAMES - 1], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: Easing.out(Easing.cubic),
        })
      : 0;

    const chromaOutAlpha = hasChromaOut
      ? interpolate(
          frame,
          [scene.durationFrames - CHROMA_EDGE_FRAMES, scene.durationFrames - 1],
          [0, 1],
          {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.in(Easing.cubic),
          },
        )
      : 0;

    const chromaAlpha = Math.max(chromaInAlpha, chromaOutAlpha);
    const chromaSeed = hasChromaIn ? seedFromPrev : hasChromaOut ? seedToNext : 0;
    const chroma = chromaSeed ? getChromaParams(chromaSeed) : null;
    const chromaShift =
      chroma && chromaAlpha > 0
        ? CHROMA_MAX_SHIFT_PX * chroma.strength * chromaAlpha
        : 0;
    const chromaBlur =
      chroma && chromaAlpha > 0
        ? CHROMA_MAX_BLUR_PX * chroma.strength * chromaAlpha
        : 0;

    const mediaContent = scene.videoSrc ? (
      <OffthreadVideo
        src={resolveMediaSrc(scene.videoSrc)}
        muted
        pauseWhenBuffering
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    ) : scene.imageSrc ? (
      <>
        <GlitchImage
          src={resolveMediaSrc(scene.imageSrc)}
          style={imageStyle}
          frame={frame}
          durationFrames={scene.durationFrames}
          seedStart={seedFromPrev}
          seedEnd={seedToNext}
          enableStart={transitionFromPrev === 'glitch'}
          enableEnd={transitionToNext === 'glitch'}
        />

        {/* Chroma leak overlays */}
        {chroma && chromaAlpha > 0.001 ? (
          <>
            <AbsoluteFill
              style={{ opacity: 0.6 * chromaAlpha, mixBlendMode: 'screen' }}
            >
              <Img
                src={resolveMediaSrc(scene.imageSrc)}
                style={{
                  ...imageStyle,
                  transform: `${imageStyle.transform ?? ''} translate(${(
                    chroma.dirX * chromaShift
                  ).toFixed(2)}px, ${(
                    -chroma.dirY * chromaShift * 0.35
                  ).toFixed(2)}px)`,
                  filter: `blur(${chromaBlur.toFixed(
                    2,
                  )}px) saturate(1.4) hue-rotate(-18deg) contrast(1.12)`,
                }}
              />
            </AbsoluteFill>

            <AbsoluteFill
              style={{ opacity: 0.5 * chromaAlpha, mixBlendMode: 'screen' }}
            >
              <Img
                src={resolveMediaSrc(scene.imageSrc)}
                style={{
                  ...imageStyle,
                  transform: `${imageStyle.transform ?? ''} translate(${(
                    -chroma.dirX * chromaShift * 1.15
                  ).toFixed(2)}px, ${(
                    chroma.dirY * chromaShift * 0.45
                  ).toFixed(2)}px)`,
                  filter: `blur(${(chromaBlur * 0.9).toFixed(
                    2,
                  )}px) saturate(1.25) hue-rotate(24deg) contrast(1.1)`,
                }}
              />
            </AbsoluteFill>

            {/* Light leak bloom */}
            <AbsoluteFill
              style={{
                opacity: 0.55 * chromaAlpha,
                mixBlendMode: 'screen',
                background: `radial-gradient(circle at ${chroma.originX}% ${chroma.originY}%, rgba(255, 80, 200, 0.55) 0%, rgba(80, 160, 255, 0.30) 35%, rgba(0,0,0,0) 68%)`,
              }}
            />
            <AbsoluteFill
              style={{
                opacity: 0.25 * chromaAlpha,
                mixBlendMode: 'screen',
                background:
                  'linear-gradient(120deg, rgba(255,0,170,0) 0%, rgba(255,0,170,0.22) 40%, rgba(80,160,255,0.18) 65%, rgba(0,0,0,0) 100%)',
              }}
            />
          </>
        ) : null}
      </>
    ) : null;

    const animatedLightingOn = visualEffect === 'animatedLighting';
    const lightingSeed = mulberry32((scene.index + 1) * 4409)();
    const lightingX = ((frame * 0.55 + lightingSeed * 320) % 100 + 100) % 100;
    const lightingY = (35 + 25 * Math.sin(frame * 0.03 + lightingSeed * 8)) % 100;
    const lightingAlpha = 0.22 + 0.10 * Math.sin(frame * 0.045 + lightingSeed * 12);

    const mediaLayer = mediaContent ? (
      <AbsoluteFill style={{ ...backgroundStyle, filter: wrapperFilter }}>
        {mediaContent}
        {animatedLightingOn ? (
          <AbsoluteFill
            style={{
              opacity: Math.max(0, Math.min(0.42, lightingAlpha)),
              mixBlendMode: 'screen',
              background: `radial-gradient(circle at ${lightingX.toFixed(
                2,
              )}% ${lightingY.toFixed(
                2,
              )}%, rgba(255, 80, 200, 0.55) 0%, rgba(80, 160, 255, 0.30) 38%, rgba(0,0,0,0) 70%)`,
              pointerEvents: 'none',
            }}
          />
        ) : null}
      </AbsoluteFill>
    ) : null;

    return (
      <AbsoluteFill style={{ backgroundColor: 'black' }}>
        {mediaLayer}

        {/* Suspense opening overlay */}
        {isSuspenseOpening ? (
          <SuspenseOverlay
            frame={frame}
            jitterX={jitterX}
            scratchAlpha={scratchAlpha}
            verticalGlitchAlpha={verticalGlitchAlpha}
            bandOn={bandOn}
            bandX={bandX}
            bandW={bandW}
            hardPulse={hardPulse}
            scratchPulse={scratchPulse}
            spliceOn={spliceOn}
            spliceX={spliceX}
            suspenseFlicker={suspenseFlicker}
            softPulse={softPulse}
          />
        ) : null}

        {showSubtitles ? (
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
                color: 'white',
                padding: '18px 22px',
                borderRadius: 18,
                fontSize: 60 * fontScale,
                fontWeight: 700,
                fontFamily: 'Oswald, system-ui, sans-serif',
                lineHeight: 1.15,
                marginBottom: isShort ? '400px' : '10px',
                textAlign: 'center',
                textShadow: '0 2px 10px rgba(0,0,0,0.55)',
                opacity: 1,
              }}
            >
              {scene.text}
            </div>
          </AbsoluteFill>
        ) : null}

        {/* Fade overlay below flash so flash isn't darkened if both ever overlap */}
        {fadeAlpha > 0.001 ? (
          <AbsoluteFill
            style={{
              backgroundColor: 'black',
              opacity: fadeAlpha,
              pointerEvents: 'none',
            }}
          />
        ) : null}

        {flashAlpha > 0.001 ? (
          <AbsoluteFill
            style={{
              backgroundColor: 'white',
              opacity: flashAlpha,
              pointerEvents: 'none',
            }}
          />
        ) : null}
      </AbsoluteFill>
    );
  },
);

Scene.displayName = 'Scene';
