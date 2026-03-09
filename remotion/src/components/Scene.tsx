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
  GLITCH_EDGE_FRAMES,
  IMAGE_CINEMATIC_PAN_X_MULTIPLIER,
  IMAGE_DIAGONAL_DRIFT_X_MULTIPLIER,
  IMAGE_DIAGONAL_DRIFT_Y_MULTIPLIER,
  IMAGE_FOCUS_SHIFT_X_MULTIPLIER,
  IMAGE_FOCUS_SHIFT_Y_MULTIPLIER,
  IMAGE_PARALLAX_X_MULTIPLIER,
  IMAGE_PARALLAX_Y_MULTIPLIER,
  IMAGE_ROTATION_DRIFT_X_MULTIPLIER,
  IMAGE_ROTATION_DRIFT_Y_MULTIPLIER,
  IMAGE_SHAKE_MICRO_X_MULTIPLIER,
  IMAGE_SHAKE_MICRO_Y_MULTIPLIER,
  IMAGE_SLOW_ZOOM_IN_PER_SECOND,
  IMAGE_SLOW_ZOOM_OUT_PER_SECOND,
  IMAGE_SLOW_ZOOM_OUT_START_SCALE,
  IMAGE_SPLIT_MOTION_X_MULTIPLIER,
  IMAGE_SPLIT_MOTION_Y_MULTIPLIER,
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
// import { loadFont as loadNotoKufiArabic } from '@remotion/google-fonts/NotoKufiArabic';

// const { fontFamily: notoKufiArabicFontFamily } = loadNotoKufiArabic();

export const Scene: React.FC<{
  scene: TimelineScene;
  language?: string;
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
    language,
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

    const normalizedLanguage = String(language ?? '')
      .trim()
      .toLowerCase();
    const isArabic =
      normalizedLanguage === 'ar' ||
      normalizedLanguage.startsWith('ar-') ||
      normalizedLanguage.startsWith('ar_') ||
      normalizedLanguage.includes('arab');
    const subtitleFontFamily = isArabic
      ? `Noto Kufi Arabic, sans-serif`
      : 'Oswald, system-ui, sans-serif';

    // Inside a <Sequence>, useCurrentFrame() is already relative to the Sequence start.
    // Clamp to 0 to ensure each scene starts at default scale.
    const elapsedSeconds = Math.max(0, frame) / fps;
    const motionProgress =
      scene.durationFrames <= 1
        ? 1
        : clamp01(frame / Math.max(1, scene.durationFrames - 1));

    const isSuspenseOpening = scene.index === 0 && Boolean(scene.isSuspense);
    const suspenseFilter = isSuspenseOpening
      ? 'grayscale(1) contrast(1.38) brightness(0.88)'
      : undefined;

    const visualEffect = scene.visualEffect ?? null;

    const isGlassSubtle = visualEffect === 'glassSubtle';
    const isGlassReflections = visualEffect === 'glassReflections';
    const isGlassStrong = visualEffect === 'glassStrong';

    const glassFilter = isGlassSubtle
      ? 'contrast(1.06) saturate(1.08) brightness(1.02)'
      : isGlassReflections
        ? 'contrast(1.07) saturate(1.10) brightness(1.02)'
        : isGlassStrong
          ? 'contrast(1.10) saturate(1.12) brightness(1.03)'
          : undefined;

    const colorGradingFilter =
      visualEffect === 'colorGrading'
        ? 'contrast(1.12) saturate(1.16) brightness(0.98)'
        : undefined;

    const wrapperFilter = [suspenseFilter, colorGradingFilter, glassFilter]
      .filter(Boolean)
      .join(' ') || undefined;

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

    const motionEffect = scene.imageMotionEffect ?? 'default';
    const motionSpeed = Math.min(
      2.5,
      Math.max(
        0.5,
        typeof scene.imageMotionSpeed === 'number' &&
          Number.isFinite(scene.imageMotionSpeed)
          ? scene.imageMotionSpeed
          : 1,
      ),
    );
    const motionEasing = Easing.inOut(Easing.cubic);
    const focusShiftVariant = scene.index % 4;
    const scaledElapsedSeconds = elapsedSeconds * motionSpeed;
    const scaledMotionProgress = clamp01(motionProgress * motionSpeed);
    const motionPhase = motionProgress * motionSpeed;

    const focusTransformOrigin =
      focusShiftVariant === 0
        ? '34% 34%'
        : focusShiftVariant === 1
          ? '66% 34%'
          : focusShiftVariant === 2
            ? '38% 68%'
            : '64% 66%';

    let motionScale = 1 + IMAGE_ZOOM_PER_SECOND * scaledElapsedSeconds;
    let motionTranslateX = 0;
    let motionTranslateY = 0;
    let motionRotate = 0;
    let motionTransformOrigin = 'center center';

    if (motionEffect === 'slowZoomIn') {
      motionScale = 1 + IMAGE_SLOW_ZOOM_IN_PER_SECOND * scaledElapsedSeconds;
    } else if (motionEffect === 'slowZoomOut') {
      motionScale = Math.max(
        1.005,
        IMAGE_SLOW_ZOOM_OUT_START_SCALE -
          IMAGE_SLOW_ZOOM_OUT_PER_SECOND * scaledElapsedSeconds,
      );
    } else if (motionEffect === 'diagonalDrift') {
      motionScale = 1.035 + 0.04 * scaledMotionProgress;
      motionTranslateX = interpolate(
        scaledMotionProgress,
        [0, 1],
        [-width * IMAGE_DIAGONAL_DRIFT_X_MULTIPLIER, width * IMAGE_DIAGONAL_DRIFT_X_MULTIPLIER],
        { easing: motionEasing },
      );
      motionTranslateY = interpolate(
        scaledMotionProgress,
        [0, 1],
        [-height * IMAGE_DIAGONAL_DRIFT_Y_MULTIPLIER, height * IMAGE_DIAGONAL_DRIFT_Y_MULTIPLIER],
        { easing: motionEasing },
      );
    } else if (motionEffect === 'cinematicPan') {
      motionScale = 1.08;
      motionTranslateX = interpolate(
        scaledMotionProgress,
        [0, 1],
        [-width * IMAGE_CINEMATIC_PAN_X_MULTIPLIER, width * IMAGE_CINEMATIC_PAN_X_MULTIPLIER],
        { easing: motionEasing },
      );
      motionTranslateY = Math.sin(scaledMotionProgress * Math.PI) * height * 0.008;
    } else if (motionEffect === 'focusShift') {
      motionScale = 1.03 + 0.07 * scaledMotionProgress;
      motionTransformOrigin = focusTransformOrigin;
      motionTranslateX = interpolate(
        scaledMotionProgress,
        [0, 1],
        [
          focusShiftVariant === 1 || focusShiftVariant === 3
            ? width * IMAGE_FOCUS_SHIFT_X_MULTIPLIER
            : -width * IMAGE_FOCUS_SHIFT_X_MULTIPLIER,
          focusShiftVariant === 1 || focusShiftVariant === 3
            ? -width * IMAGE_FOCUS_SHIFT_X_MULTIPLIER
            : width * IMAGE_FOCUS_SHIFT_X_MULTIPLIER,
        ],
        { easing: motionEasing },
      );
      motionTranslateY = interpolate(
        scaledMotionProgress,
        [0, 1],
        [
          focusShiftVariant >= 2
            ? height * IMAGE_FOCUS_SHIFT_Y_MULTIPLIER
            : -height * IMAGE_FOCUS_SHIFT_Y_MULTIPLIER,
          focusShiftVariant >= 2
            ? -height * IMAGE_FOCUS_SHIFT_Y_MULTIPLIER
            : height * IMAGE_FOCUS_SHIFT_Y_MULTIPLIER,
        ],
        { easing: motionEasing },
      );
    } else if (motionEffect === 'parallaxMotion') {
      motionScale = 1.09 + 0.045 * scaledMotionProgress;
      motionTranslateX = interpolate(
        scaledMotionProgress,
        [0, 1],
        [-width * IMAGE_PARALLAX_X_MULTIPLIER, width * IMAGE_PARALLAX_X_MULTIPLIER],
        { easing: motionEasing },
      );
      motionTranslateY = Math.sin(scaledMotionProgress * Math.PI * 1.2) * height * IMAGE_PARALLAX_Y_MULTIPLIER;
      motionRotate = interpolate(scaledMotionProgress, [0, 1], [-0.8, 0.9], {
        easing: motionEasing,
      });
      motionTransformOrigin = '50% 42%';
    } else if (motionEffect === 'shakeMicroMotion') {
      motionScale = 1.045 + 0.015 * scaledMotionProgress;
      motionTranslateX =
        Math.sin(motionPhase * Math.PI * 9) *
        width *
        IMAGE_SHAKE_MICRO_X_MULTIPLIER;
      motionTranslateY =
        Math.cos(motionPhase * Math.PI * 10) *
        height *
        IMAGE_SHAKE_MICRO_Y_MULTIPLIER;
      motionRotate = Math.sin(motionPhase * Math.PI * 8) * 0.35;
    } else if (motionEffect === 'splitMotion') {
      motionScale = 1.09 + 0.03 * Math.sin(scaledMotionProgress * Math.PI);
      if (scaledMotionProgress < 0.5) {
        motionTranslateX = interpolate(
          scaledMotionProgress,
          [0, 0.5],
          [
            -width * IMAGE_SPLIT_MOTION_X_MULTIPLIER,
            width * IMAGE_SPLIT_MOTION_X_MULTIPLIER,
          ],
          { easing: motionEasing },
        );
        motionTranslateY = interpolate(
          scaledMotionProgress,
          [0, 0.5],
          [
            -height * IMAGE_SPLIT_MOTION_Y_MULTIPLIER,
            height * IMAGE_SPLIT_MOTION_Y_MULTIPLIER * 0.4,
          ],
          { easing: motionEasing },
        );
        motionRotate = interpolate(scaledMotionProgress, [0, 0.5], [-0.55, 0.45], {
          easing: motionEasing,
        });
      } else {
        motionTranslateX = interpolate(
          scaledMotionProgress,
          [0.5, 1],
          [
            width * IMAGE_SPLIT_MOTION_X_MULTIPLIER,
            -width * IMAGE_SPLIT_MOTION_X_MULTIPLIER * 0.5,
          ],
          { easing: motionEasing },
        );
        motionTranslateY = interpolate(
          scaledMotionProgress,
          [0.5, 1],
          [
            height * IMAGE_SPLIT_MOTION_Y_MULTIPLIER * 0.4,
            height * IMAGE_SPLIT_MOTION_Y_MULTIPLIER * 1.25,
          ],
          { easing: motionEasing },
        );
        motionRotate = interpolate(scaledMotionProgress, [0.5, 1], [0.45, -0.25], {
          easing: motionEasing,
        });
      }
    } else if (motionEffect === 'rotationDrift') {
      motionScale = 1.055 + 0.045 * scaledMotionProgress;
      motionTranslateX = interpolate(
        scaledMotionProgress,
        [0, 1],
        [
          -width * IMAGE_ROTATION_DRIFT_X_MULTIPLIER,
          width * IMAGE_ROTATION_DRIFT_X_MULTIPLIER,
        ],
        { easing: motionEasing },
      );
      motionTranslateY = Math.sin(scaledMotionProgress * Math.PI * 1.4) * height * IMAGE_ROTATION_DRIFT_Y_MULTIPLIER;
      motionRotate = interpolate(scaledMotionProgress, [0, 1], [-1.2, 1.35], {
        easing: motionEasing,
      });
      motionTransformOrigin = '52% 46%';
    }

    const whipSkew = (whipBlur / WHIP_MAX_BLUR_PX) * 6 * (whipX >= 0 ? 1 : -1);

    // Glitch (generic overlay so it works for both images and videos).
    const hasGlitchIn =
      transitionFromPrev === 'glitch' && frame < GLITCH_EDGE_FRAMES;
    const hasGlitchOut =
      transitionToNext === 'glitch' &&
      frame >= scene.durationFrames - GLITCH_EDGE_FRAMES;

    const glitchInAlpha = hasGlitchIn
      ? interpolate(frame, [0, GLITCH_EDGE_FRAMES - 1], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: Easing.out(Easing.cubic),
        })
      : 0;

    const glitchOutAlpha = hasGlitchOut
      ? interpolate(
          frame,
          [scene.durationFrames - GLITCH_EDGE_FRAMES, scene.durationFrames - 1],
          [0, 1],
          {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.in(Easing.cubic),
          },
        )
      : 0;

    const glitchAlpha = Math.max(glitchInAlpha, glitchOutAlpha);
    const glitchSeed = hasGlitchIn ? seedFromPrev : hasGlitchOut ? seedToNext : 0;
    const glitchRand = glitchSeed
      ? mulberry32(glitchSeed ^ (frame * 31 + scene.index * 997))
      : null;
    const glitchJitterX =
      glitchRand && glitchAlpha > 0
        ? (glitchRand() * 2 - 1) * 10 * glitchAlpha
        : 0;
    const glitchJitterY =
      glitchRand && glitchAlpha > 0
        ? (glitchRand() * 2 - 1) * 6 * glitchAlpha
        : 0;

    const mediaTransformStyle: React.CSSProperties = {
      width: '100%',
      height: '100%',
      transformOrigin: motionTransformOrigin,
      transform: `translate(${(motionTranslateX + whipX + glitchJitterX).toFixed(2)}px, ${(motionTranslateY + glitchJitterY).toFixed(2)}px) rotate(${motionRotate.toFixed(2)}deg) skewX(${whipSkew.toFixed(2)}deg) scale(${motionScale.toFixed(6)})`,
      willChange: 'transform, filter',
      filter:
        whipBlur > 0.01
          ? `blur(${whipBlur.toFixed(2)}px) contrast(1.08) saturate(1.04)`
          : undefined,
    };

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

    // Generic chroma light-leak overlay (works for both images and videos).
    const chromaOverlay = chroma && chromaAlpha > 0.001 ? (
      <>
        {/* Light leak bloom */}
        <AbsoluteFill
          style={{
            opacity: 0.55 * chromaAlpha,
            mixBlendMode: 'screen',
            background: `radial-gradient(circle at ${chroma.originX}% ${chroma.originY}%, rgba(255, 80, 200, 0.55) 0%, rgba(80, 160, 255, 0.30) 35%, rgba(0,0,0,0) 68%)`,
            pointerEvents: 'none',
          }}
        />
        <AbsoluteFill
          style={{
            opacity: 0.25 * chromaAlpha,
            mixBlendMode: 'screen',
            background:
              'linear-gradient(120deg, rgba(255,0,170,0) 0%, rgba(255,0,170,0.22) 40%, rgba(80,160,255,0.18) 65%, rgba(0,0,0,0) 100%)',
            pointerEvents: 'none',
          }}
        />
      </>
    ) : null;

    const glitchOverlay = glitchAlpha > 0.001 ? (
      <>
        <AbsoluteFill
          style={{
            opacity: 0.12 * glitchAlpha,
            mixBlendMode: 'overlay',
            background:
              'repeating-linear-gradient(0deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, rgba(0,0,0,0) 3px, rgba(0,0,0,0) 6px)',
            transform: `translateX(${(glitchJitterX * 2).toFixed(2)}px)`,
            pointerEvents: 'none',
          }}
        />
        <AbsoluteFill
          style={{
            opacity: 0.10 * glitchAlpha,
            mixBlendMode: 'screen',
            background:
              'linear-gradient(90deg, rgba(255,0,120,0.0) 0%, rgba(255,0,120,0.18) 50%, rgba(0,160,255,0.0) 100%)',
            transform: `translateX(${(-glitchJitterX * 1.4).toFixed(2)}px)`,
            pointerEvents: 'none',
          }}
        />
      </>
    ) : null;

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
                  transform: `translate(${(
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
                  transform: `translate(${(
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
          </>
        ) : null}
      </>
    ) : null;

    const animatedLightingOn = visualEffect === 'animatedLighting';
    const lightingSeed = mulberry32((scene.index + 1) * 4409)();
    // Disable animation: keep the initial (frame=0) lighting look.
    const lightingX = ((lightingSeed * 320) % 100 + 100) % 100;
    const lightingY = (35 + 25 * Math.sin(lightingSeed * 8) + 100) % 100;
    const lightingAlpha = 0.22 + 0.1 * Math.sin(lightingSeed * 12);

    const glassOverlayOn = isGlassReflections || isGlassStrong;
    const glassOverlayOpacity = isGlassStrong ? 0.22 : 0.16;

    const mediaLayer = mediaContent ? (
      <AbsoluteFill style={{ ...backgroundStyle, filter: wrapperFilter }}>
        <AbsoluteFill style={mediaTransformStyle}>{mediaContent}</AbsoluteFill>
        {chromaOverlay}
        {glitchOverlay}
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

        {glassOverlayOn ? (
          <AbsoluteFill
            style={{
              opacity: glassOverlayOpacity,
              mixBlendMode: 'screen',
              background:
                'linear-gradient(135deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.08) 18%, rgba(255,255,255,0.00) 45%, rgba(255,255,255,0.10) 62%, rgba(255,255,255,0.00) 100%)',
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
                fontFamily: subtitleFontFamily,
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
