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
import { ProgressiveSubtitles } from './ProgressiveSubtitles';
import { SuspenseOverlay } from './SuspenseOverlay';
// import { loadFont as loadNotoKufiArabic } from '@remotion/google-fonts/NotoKufiArabic';

// const { fontFamily: notoKufiArabicFontFamily } = loadNotoKufiArabic();

type SceneVisualEffect = TimelineScene['visualEffect'];
type SceneMotionEffect = NonNullable<TimelineScene['imageMotionEffect']>;

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const getNumeric = (
  value: unknown,
  fallback: number,
  min?: number,
  max?: number,
) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (typeof min === 'number' && typeof max === 'number') {
    return clampNumber(numeric, min, max);
  }
  if (typeof min === 'number') return Math.max(min, numeric);
  if (typeof max === 'number') return Math.min(max, numeric);
  return numeric;
};

const getBoolean = (value: unknown, fallback = false) => {
  if (typeof value === 'boolean') return value;
  return fallback;
};

const DEFAULT_IMAGE_MOTION_SPEED = 1.2;

const normalizeMotionSpeed = (value: unknown) =>
  clampNumber(getNumeric(value, DEFAULT_IMAGE_MOTION_SPEED), 0.5, 2.5);

const getPingPongProgress = (value: number) => {
  const wrapped = ((value % 2) + 2) % 2;
  return wrapped <= 1 ? wrapped : 2 - wrapped;
};

const MOTION_CYCLE_DURATION_SECONDS = 6.2;

const getDefaultImageFilterSettings = (effect: SceneVisualEffect | null | undefined) => {
  if (effect === 'colorGrading') {
    return {
      saturation: 1.16,
      contrast: 1.12,
      brightness: 0.98,
      blurPx: 0,
      sepia: 0,
      grayscale: 0,
      hueRotateDeg: 0,
      animatedLightingIntensity: 0,
      glassOverlayOpacity: 0,
    };
  }
  if (effect === 'animatedLighting') {
    return {
      saturation: 1,
      contrast: 1,
      brightness: 1,
      blurPx: 0,
      sepia: 0,
      grayscale: 0,
      hueRotateDeg: 0,
      animatedLightingIntensity: 0.34,
      glassOverlayOpacity: 0,
    };
  }
  if (effect === 'glassSubtle') {
    return {
      saturation: 1.08,
      contrast: 1.06,
      brightness: 1.02,
      blurPx: 0,
      sepia: 0,
      grayscale: 0,
      hueRotateDeg: 0,
      animatedLightingIntensity: 0,
      glassOverlayOpacity: 0,
    };
  }
  if (effect === 'glassReflections') {
    return {
      saturation: 1.1,
      contrast: 1.07,
      brightness: 1.02,
      blurPx: 0,
      sepia: 0,
      grayscale: 0,
      hueRotateDeg: 0,
      animatedLightingIntensity: 0,
      glassOverlayOpacity: 0.16,
    };
  }
  if (effect === 'glassStrong') {
    return {
      saturation: 1.12,
      contrast: 1.1,
      brightness: 1.03,
      blurPx: 0,
      sepia: 0,
      grayscale: 0,
      hueRotateDeg: 0,
      animatedLightingIntensity: 0,
      glassOverlayOpacity: 0.22,
    };
  }
  return {
    saturation: 1,
    contrast: 1,
    brightness: 1,
    blurPx: 0,
    sepia: 0,
    grayscale: 0,
    hueRotateDeg: 0,
    animatedLightingIntensity: 0,
    glassOverlayOpacity: 0,
  };
};

const normalizeImageFilterSettings = (
  settings: Record<string, unknown> | null | undefined,
  fallbackEffect: SceneVisualEffect | null | undefined,
) => {
  const defaults = getDefaultImageFilterSettings(fallbackEffect);
  return {
    saturation: getNumeric(settings?.saturation, defaults.saturation, 0, 2.5),
    contrast: getNumeric(settings?.contrast, defaults.contrast, 0, 2.5),
    brightness: getNumeric(settings?.brightness, defaults.brightness, 0, 2.5),
    blurPx: getNumeric(settings?.blurPx, defaults.blurPx, 0, 20),
    sepia: getNumeric(settings?.sepia, defaults.sepia, 0, 1),
    grayscale: getNumeric(settings?.grayscale, defaults.grayscale, 0, 1),
    hueRotateDeg: getNumeric(settings?.hueRotateDeg, defaults.hueRotateDeg, -180, 180),
    animatedLightingIntensity: getNumeric(
      settings?.animatedLightingIntensity,
      defaults.animatedLightingIntensity,
      0,
      1,
    ),
    glassOverlayOpacity: getNumeric(
      settings?.glassOverlayOpacity,
      defaults.glassOverlayOpacity,
      0,
      0.4,
    ),
  };
};

const getDefaultImageMotionSettings = (
  effect: SceneMotionEffect | null | undefined,
  speed: unknown,
) => {
  const normalizedSpeed = normalizeMotionSpeed(speed);
  const base = {
    speed: normalizedSpeed,
    originX: 50,
    originY: 50,
    scaleEndNoLimit: true,
    translateXEndNoLimit: true,
    translateYEndNoLimit: true,
    rotateEndNoLimit: true,
  };

  if (effect === 'slowZoomIn') {
    return { ...base, startScale: 1.01, endScale: 1.085, translateXStart: 0, translateXEnd: 0, translateYStart: 0, translateYEnd: 0, rotateStart: 0, rotateEnd: 0 };
  }
  if (effect === 'slowZoomOut') {
    return { ...base, startScale: 1.095, endScale: 1.01, translateXStart: 0, translateXEnd: 0, translateYStart: 0, translateYEnd: 0, rotateStart: 0, rotateEnd: 0 };
  }
  if (effect === 'diagonalDrift') {
    return { ...base, startScale: 1.04, endScale: 1.09, translateXStart: -3.5, translateXEnd: 3.5, translateYStart: -2.5, translateYEnd: 2.5, rotateStart: 0, rotateEnd: 0 };
  }
  if (effect === 'cinematicPan') {
    return { ...base, startScale: 1.08, endScale: 1.08, translateXStart: -4.5, translateXEnd: 4.5, translateYStart: 0, translateYEnd: 0, rotateStart: 0, rotateEnd: 0 };
  }
  if (effect === 'focusShift') {
    return { ...base, originX: 38, originY: 34, startScale: 1.03, endScale: 1.1, translateXStart: 2, translateXEnd: 1, translateYStart: 1.5, translateYEnd: -2, rotateStart: 0, rotateEnd: 0 };
  }
  if (effect === 'parallaxMotion') {
    return { ...base, originX: 50, originY: 42, startScale: 1.09, endScale: 1.11, translateXStart: -2, translateXEnd: 2.5, translateYStart: -1, translateYEnd: 1.5, rotateStart: -0.8, rotateEnd: 1 };
  }
  if (effect === 'shakeMicroMotion') {
    return { ...base, startScale: 1.045, endScale: 1.058, translateXStart: -0.45, translateXEnd: 0.42, translateYStart: 0.2, translateYEnd: -0.24, rotateStart: -0.35, rotateEnd: 0.28 };
  }
  if (effect === 'splitMotion') {
    return { ...base, startScale: 1.09, endScale: 1.11, translateXStart: -2.8, translateXEnd: -1.4, translateYStart: -1.2, translateYEnd: 2.4, rotateStart: -0.55, rotateEnd: -0.25 };
  }
  if (effect === 'rotationDrift') {
    return { ...base, originX: 52, originY: 46, startScale: 1.055, endScale: 1.1, translateXStart: -1.2, translateXEnd: 0.8, translateYStart: 0.6, translateYEnd: 1.2, rotateStart: -1.2, rotateEnd: 1.35 };
  }
  return { ...base, startScale: 1, endScale: 1.055, translateXStart: 0, translateXEnd: 0, translateYStart: 0, translateYEnd: 0, rotateStart: 0, rotateEnd: 0 };
};

const normalizeImageMotionSettings = (
  settings: Record<string, unknown> | null | undefined,
  fallbackEffect: SceneMotionEffect | null | undefined,
  fallbackSpeed: unknown,
) => {
  const defaults = getDefaultImageMotionSettings(fallbackEffect, fallbackSpeed);
  return {
    speed: normalizeMotionSpeed(settings?.speed ?? defaults.speed),
    startScale: getNumeric(settings?.startScale, defaults.startScale, 0.5, 2),
    endScale: getNumeric(settings?.endScale, defaults.endScale, 0.5, 2),
    scaleEndNoLimit: getBoolean(settings?.scaleEndNoLimit, defaults.scaleEndNoLimit),
    translateXStart: getNumeric(settings?.translateXStart, defaults.translateXStart, -20, 20),
    translateXEnd: getNumeric(settings?.translateXEnd, defaults.translateXEnd, -20, 20),
    translateXEndNoLimit: getBoolean(
      settings?.translateXEndNoLimit,
      defaults.translateXEndNoLimit,
    ),
    translateYStart: getNumeric(settings?.translateYStart, defaults.translateYStart, -20, 20),
    translateYEnd: getNumeric(settings?.translateYEnd, defaults.translateYEnd, -20, 20),
    translateYEndNoLimit: getBoolean(
      settings?.translateYEndNoLimit,
      defaults.translateYEndNoLimit,
    ),
    rotateStart: getNumeric(settings?.rotateStart, defaults.rotateStart, -10, 10),
    rotateEnd: getNumeric(settings?.rotateEnd, defaults.rotateEnd, -10, 10),
    rotateEndNoLimit: getBoolean(settings?.rotateEndNoLimit, defaults.rotateEndNoLimit),
    originX: getNumeric(settings?.originX, defaults.originX, 0, 100),
    originY: getNumeric(settings?.originY, defaults.originY, 0, 100),
  };
};

const interpolateMotionValue = (params: {
  start: number;
  end: number;
  boundedProgress: number;
  extendedProgress: number;
  noLimit: boolean;
  easing: (input: number) => number;
}) => {
  if (params.noLimit) {
    return interpolate(
      params.extendedProgress,
      [0, 1],
      [params.start, params.end],
      {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'extend',
      },
    );
  }

  return interpolate(
    params.boundedProgress,
    [0, 1],
    [params.start, params.end],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: params.easing,
    },
  );
};

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
    const isSuspenseOpening = scene.index === 0 && Boolean(scene.isSuspense);
    const suspenseFilter = isSuspenseOpening
      ? 'grayscale(1) contrast(1.38) brightness(0.88)'
      : undefined;

    const visualEffect = scene.visualEffect ?? null;
    const resolvedLook = normalizeImageFilterSettings(
      scene.imageFilterSettings,
      visualEffect,
    );

    const lookFilter = [
      `saturate(${resolvedLook.saturation.toFixed(3)})`,
      `contrast(${resolvedLook.contrast.toFixed(3)})`,
      `brightness(${resolvedLook.brightness.toFixed(3)})`,
      resolvedLook.blurPx > 0.001 ? `blur(${resolvedLook.blurPx.toFixed(2)}px)` : null,
      resolvedLook.sepia > 0.001 ? `sepia(${resolvedLook.sepia.toFixed(3)})` : null,
      resolvedLook.grayscale > 0.001
        ? `grayscale(${resolvedLook.grayscale.toFixed(3)})`
        : null,
      Math.abs(resolvedLook.hueRotateDeg) > 0.001
        ? `hue-rotate(${resolvedLook.hueRotateDeg.toFixed(2)}deg)`
        : null,
    ]
      .filter(Boolean)
      .join(' ');

    const wrapperFilter = [suspenseFilter, lookFilter].filter(Boolean).join(' ') || undefined;

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

    const motionEffect = (scene.imageMotionEffect ?? 'default') as SceneMotionEffect;
    const resolvedMotion = normalizeImageMotionSettings(
      scene.imageMotionSettings,
      motionEffect,
      scene.imageMotionSpeed,
    );
    const motionSpeed = resolvedMotion.speed;
    const motionEasing = Easing.inOut(Easing.cubic);
    const forwardMotionProgress =
      Math.max(0, elapsedSeconds / MOTION_CYCLE_DURATION_SECONDS) * motionSpeed;
    const scaledMotionProgress = getPingPongProgress(forwardMotionProgress);
    const usesAutomaticDefaultScale = motionEffect === 'default';
    const motionScale = usesAutomaticDefaultScale
      ? clampNumber(1 + elapsedSeconds * IMAGE_ZOOM_PER_SECOND * motionSpeed, 0.5, 2)
      : interpolateMotionValue({
          start: resolvedMotion.startScale,
          end: resolvedMotion.endScale,
          boundedProgress: scaledMotionProgress,
          extendedProgress: forwardMotionProgress,
          noLimit: resolvedMotion.scaleEndNoLimit === true,
          easing: motionEasing,
        });
    const motionTranslateX = interpolateMotionValue({
      start: width * (resolvedMotion.translateXStart / 100),
      end: width * (resolvedMotion.translateXEnd / 100),
      boundedProgress: scaledMotionProgress,
      extendedProgress: forwardMotionProgress,
      noLimit: resolvedMotion.translateXEndNoLimit === true,
      easing: motionEasing,
    });
    const motionTranslateY = interpolateMotionValue({
      start: height * (resolvedMotion.translateYStart / 100),
      end: height * (resolvedMotion.translateYEnd / 100),
      boundedProgress: scaledMotionProgress,
      extendedProgress: forwardMotionProgress,
      noLimit: resolvedMotion.translateYEndNoLimit === true,
      easing: motionEasing,
    });
    const motionRotate = interpolateMotionValue({
      start: resolvedMotion.rotateStart,
      end: resolvedMotion.rotateEnd,
      boundedProgress: scaledMotionProgress,
      extendedProgress: forwardMotionProgress,
      noLimit: resolvedMotion.rotateEndNoLimit === true,
      easing: motionEasing,
    });
    const motionTransformOrigin = `${resolvedMotion.originX.toFixed(2)}% ${resolvedMotion.originY.toFixed(2)}%`;

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

    const resolvedPrimaryImageSrc = scene.imageSrc
      ? resolveMediaSrc(scene.imageSrc)
      : null;
    const resolvedSecondaryImageSrc = scene.secondaryImageSrc
      ? resolveMediaSrc(scene.secondaryImageSrc)
      : null;
    const halfSceneFrame = Math.max(0, scene.durationFrames / 2);
    const imageCrossfadeFrames = resolvedSecondaryImageSrc
      ? Math.max(
          8,
          Math.min(27, Math.floor(Math.max(1, scene.durationFrames) * 0.3)),
        )
      : 0;
    const crossfadeStartFrame = halfSceneFrame - imageCrossfadeFrames / 2;
    const crossfadeEndFrame = halfSceneFrame + imageCrossfadeFrames / 2;
    const secondaryImageOpacity = resolvedSecondaryImageSrc
      ? interpolate(
          frame,
          [crossfadeStartFrame, crossfadeEndFrame],
          [0, 1],
          {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.inOut(Easing.ease),
          },
        )
      : 0;
    const primaryImageOpacity = resolvedSecondaryImageSrc
      ? 1 - secondaryImageOpacity
      : 1;

    const renderImageLayer = (src: string, opacity: number) => (
      <AbsoluteFill style={{ opacity }}>
        <GlitchImage
          src={src}
          style={imageStyle}
          frame={frame}
          durationFrames={scene.durationFrames}
          seedStart={seedFromPrev}
          seedEnd={seedToNext}
          enableStart={transitionFromPrev === 'glitch'}
          enableEnd={transitionToNext === 'glitch'}
        />

        {chroma && chromaAlpha > 0.001 ? (
          <>
            <AbsoluteFill
              style={{ opacity: 0.6 * chromaAlpha, mixBlendMode: 'screen' }}
            >
              <Img
                src={src}
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
                src={src}
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
      </AbsoluteFill>
    );

    const mediaContent = scene.videoSrc ? (
      <OffthreadVideo
        src={resolveMediaSrc(scene.videoSrc)}
        muted
        pauseWhenBuffering
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    ) : resolvedPrimaryImageSrc ? (
      <>
        {renderImageLayer(resolvedPrimaryImageSrc, primaryImageOpacity)}
        {resolvedSecondaryImageSrc
          ? renderImageLayer(resolvedSecondaryImageSrc, secondaryImageOpacity)
          : null}
      </>
    ) : null;

    const animatedLightingOn = resolvedLook.animatedLightingIntensity > 0.001;
    const lightingSeed = mulberry32((scene.index + 1) * 4409)();
    // Disable animation: keep the initial (frame=0) lighting look.
    const lightingX = ((lightingSeed * 320) % 100 + 100) % 100;
    const lightingY = (35 + 25 * Math.sin(lightingSeed * 8) + 100) % 100;
    const lightingAlpha =
      (0.22 + 0.1 * Math.sin(lightingSeed * 12)) * resolvedLook.animatedLightingIntensity;

    const glassOverlayOpacity = clampNumber(resolvedLook.glassOverlayOpacity, 0, 0.4);
    const glassOverlayOn = glassOverlayOpacity > 0.001;

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
          <ProgressiveSubtitles
            text={scene.text}
            subtitleWords={scene.subtitleWords}
            frame={frame}
            fontScale={fontScale}
            isShort={isShort}
            fontFamily={subtitleFontFamily}
          />
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
