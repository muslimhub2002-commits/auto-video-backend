import { Easing, interpolate } from 'remotion';

import { IMAGE_ZOOM_PER_SECOND } from '../constants';
import type { TimelineScene } from '../types';

type SceneMotionEffect = NonNullable<TimelineScene['imageMotionEffect']>;

const DEFAULT_IMAGE_MOTION_SPEED = 2;

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

const normalizeMotionSpeed = (value: unknown) =>
  clampNumber(getNumeric(value, DEFAULT_IMAGE_MOTION_SPEED), 0.5, 2.5);

const getPingPongProgress = (value: number) => {
  const wrapped = ((value % 2) + 2) % 2;
  return wrapped <= 1 ? wrapped : 2 - wrapped;
};

const MOTION_CYCLE_DURATION_SECONDS = 6.2;

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

export function getSceneImageMotionStyle(params: {
  scene: Pick<TimelineScene, 'imageMotionEffect' | 'imageMotionSettings' | 'imageMotionSpeed'>;
  elapsedSeconds: number;
  width: number;
  height: number;
}) {
  const motionEffect = (params.scene.imageMotionEffect ?? 'default') as SceneMotionEffect;
  const resolvedMotion = normalizeImageMotionSettings(
    params.scene.imageMotionSettings,
    motionEffect,
    params.scene.imageMotionSpeed,
  );
  const motionSpeed = resolvedMotion.speed ?? 1;
  const motionEasing = Easing.inOut(Easing.cubic);
  const forwardMotionProgress =
    Math.max(0, params.elapsedSeconds / MOTION_CYCLE_DURATION_SECONDS) * motionSpeed;
  const scaledMotionProgress = getPingPongProgress(forwardMotionProgress);
  const usesAutomaticDefaultScale = motionEffect === 'default';
  const motionScale = usesAutomaticDefaultScale
    ? clampNumber(1 + params.elapsedSeconds * IMAGE_ZOOM_PER_SECOND * motionSpeed, 0.5, 2)
    : interpolateMotionValue({
        start: resolvedMotion.startScale,
        end: resolvedMotion.endScale,
        boundedProgress: scaledMotionProgress,
        extendedProgress: forwardMotionProgress,
        noLimit: resolvedMotion.scaleEndNoLimit === true,
        easing: motionEasing,
      });
  const motionTranslateX = interpolateMotionValue({
    start: params.width * (resolvedMotion.translateXStart / 100),
    end: params.width * (resolvedMotion.translateXEnd / 100),
    boundedProgress: scaledMotionProgress,
    extendedProgress: forwardMotionProgress,
    noLimit: resolvedMotion.translateXEndNoLimit === true,
    easing: motionEasing,
  });
  const motionTranslateY = interpolateMotionValue({
    start: params.height * (resolvedMotion.translateYStart / 100),
    end: params.height * (resolvedMotion.translateYEnd / 100),
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

  return {
    transformOrigin: `${resolvedMotion.originX.toFixed(2)}% ${resolvedMotion.originY.toFixed(2)}%`,
    transform: `translate(${motionTranslateX.toFixed(2)}px, ${motionTranslateY.toFixed(2)}px) rotate(${motionRotate.toFixed(2)}deg) scale(${motionScale.toFixed(6)})`,
  };
}