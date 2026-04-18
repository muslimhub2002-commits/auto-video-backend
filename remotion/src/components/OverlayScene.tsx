import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo } from 'remotion';
import type { OverlaySettings, TimelineScene } from '../types';
import { resolveMediaSrc } from '../utils/media';
import { mulberry32 } from '../utils/random';
import { TextScene } from './TextScene';

const OVERLAY_BACKGROUND_MODE_VALUES = [
  'image',
  'video',
  'solid',
  'gradient',
] as const;

const OVERLAY_TEXT_LAYER_VALUES = ['below', 'above'] as const;

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const LEGACY_OVERLAY_WIDTH_PERCENT = 26;
const LEGACY_OVERLAY_HEIGHT_PERCENT = 22;
const LEGACY_OVERLAY_OFFSET_X = 0;
const LEGACY_OVERLAY_OFFSET_Y = -4;
const LEGACY_OVERLAY_SCALE = 1;
const LEGACY_OVERLAY_ROTATION_DEG = 0;

const isApproximately = (value: number | undefined, expected: number) => {
  return Math.abs((value ?? expected) - expected) < 0.001;
};

const usesImageTabSizedOverlay = (settings: OverlaySettings) => {
  return (
    isApproximately(settings.widthPercent, LEGACY_OVERLAY_WIDTH_PERCENT) &&
    isApproximately(settings.heightPercent, LEGACY_OVERLAY_HEIGHT_PERCENT)
  );
};

const usesLegacyOverlayTransformDefaults = (settings: OverlaySettings) => {
  return (
    isApproximately(settings.offsetX, LEGACY_OVERLAY_OFFSET_X) &&
    isApproximately(settings.offsetY, LEGACY_OVERLAY_OFFSET_Y) &&
    isApproximately(settings.scale, LEGACY_OVERLAY_SCALE) &&
    isApproximately(settings.rotationDeg, LEGACY_OVERLAY_ROTATION_DEG)
  );
};

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

const getString = (value: unknown, fallback: string) => {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
};

const getDefaultImageFilterSettings = (
  effect: TimelineScene['visualEffect'] | null | undefined,
) => {
  switch (effect) {
    case 'colorGrading':
      return {
        saturation: 1.14,
        contrast: 1.08,
        brightness: 0.98,
        blurPx: 0,
        sepia: 0.08,
        grayscale: 0,
        hueRotateDeg: -6,
        animatedLightingIntensity: 0,
        glassOverlayOpacity: 0,
      };
    case 'animatedLighting':
      return {
        saturation: 1.05,
        contrast: 1.06,
        brightness: 1.02,
        blurPx: 0,
        sepia: 0,
        grayscale: 0,
        hueRotateDeg: 0,
        animatedLightingIntensity: 0.48,
        glassOverlayOpacity: 0,
      };
    case 'glassSubtle':
      return {
        saturation: 1,
        contrast: 1.03,
        brightness: 1.01,
        blurPx: 0.2,
        sepia: 0,
        grayscale: 0,
        hueRotateDeg: 0,
        animatedLightingIntensity: 0,
        glassOverlayOpacity: 0.12,
      };
    case 'glassReflections':
      return {
        saturation: 1.02,
        contrast: 1.08,
        brightness: 1,
        blurPx: 0.6,
        sepia: 0,
        grayscale: 0,
        hueRotateDeg: 0,
        animatedLightingIntensity: 0,
        glassOverlayOpacity: 0.22,
      };
    case 'glassStrong':
      return {
        saturation: 1.03,
        contrast: 1.1,
        brightness: 1,
        blurPx: 1.2,
        sepia: 0,
        grayscale: 0,
        hueRotateDeg: 0,
        animatedLightingIntensity: 0,
        glassOverlayOpacity: 0.32,
      };
    default:
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
  }
};

const normalizeImageFilterSettings = (
  settings: Record<string, unknown> | null | undefined,
  fallbackEffect: TimelineScene['visualEffect'] | null | undefined,
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

const buildImageLookFilter = (settings: ReturnType<typeof normalizeImageFilterSettings>) => {
  return [
    `saturate(${settings.saturation.toFixed(3)})`,
    `contrast(${settings.contrast.toFixed(3)})`,
    `brightness(${settings.brightness.toFixed(3)})`,
    settings.blurPx > 0.001 ? `blur(${settings.blurPx.toFixed(2)}px)` : null,
    settings.sepia > 0.001 ? `sepia(${settings.sepia.toFixed(3)})` : null,
    settings.grayscale > 0.001 ? `grayscale(${settings.grayscale.toFixed(3)})` : null,
    Math.abs(settings.hueRotateDeg) > 0.001
      ? `hue-rotate(${settings.hueRotateDeg.toFixed(2)}deg)`
      : null,
  ]
    .filter(Boolean)
    .join(' ') || undefined;
};

const getDefaultOverlaySettings = (): OverlaySettings => ({
  backgroundMode: 'image',
  widthPercent: 26,
  heightPercent: 22,
  offsetX: 0,
  offsetY: -4,
  opacity: 1,
  speed: 1,
  scale: 1,
  rotationDeg: 0,
  backgroundColor: '#020617',
  gradientFrom: '#020617',
  gradientTo: '#1d4ed8',
  gradientAngleDeg: 135,
  includeText: false,
  textLayer: 'above',
});

const normalizeOverlaySettings = (
  settings: TimelineScene['overlaySettings'],
): OverlaySettings => {
  const defaults = getDefaultOverlaySettings();
  return {
    presetKey: settings?.presetKey === 'custom' ? 'custom' : undefined,
    backgroundMode: (OVERLAY_BACKGROUND_MODE_VALUES as readonly string[]).includes(
      String(settings?.backgroundMode ?? ''),
    )
      ? (settings?.backgroundMode as OverlaySettings['backgroundMode'])
      : defaults.backgroundMode,
    widthPercent: getNumeric(settings?.widthPercent, defaults.widthPercent ?? 26, 5, 100),
    heightPercent: getNumeric(settings?.heightPercent, defaults.heightPercent ?? 22, 5, 100),
    offsetX: getNumeric(settings?.offsetX, defaults.offsetX ?? 0, -50, 50),
    offsetY: getNumeric(settings?.offsetY, defaults.offsetY ?? 0, -50, 50),
    opacity: getNumeric(settings?.opacity, defaults.opacity ?? 1, 0, 1),
    speed: getNumeric(settings?.speed, defaults.speed ?? 1, 0.25, 3),
    scale: getNumeric(settings?.scale, defaults.scale ?? 1, 0.25, 3),
    rotationDeg: getNumeric(settings?.rotationDeg, defaults.rotationDeg ?? 0, -180, 180),
    backgroundColor: getString(settings?.backgroundColor, defaults.backgroundColor ?? '#020617'),
    gradientFrom: getString(settings?.gradientFrom, defaults.gradientFrom ?? '#020617'),
    gradientTo: getString(settings?.gradientTo, defaults.gradientTo ?? '#1d4ed8'),
    gradientAngleDeg: getNumeric(
      settings?.gradientAngleDeg,
      defaults.gradientAngleDeg ?? 135,
      0,
      360,
    ),
    includeText: getBoolean(settings?.includeText, defaults.includeText ?? false),
    textLayer: (OVERLAY_TEXT_LAYER_VALUES as readonly string[]).includes(
      String(settings?.textLayer ?? ''),
    )
      ? (settings?.textLayer as OverlaySettings['textLayer'])
      : defaults.textLayer,
  };
};

const inferOverlayIsVideo = (
  src: string | undefined,
  mimeType: string | null | undefined,
) => {
  const normalizedMimeType = String(mimeType ?? '')
    .trim()
    .toLowerCase();
  if (normalizedMimeType.startsWith('video/')) return true;
  if (normalizedMimeType.startsWith('image/')) return false;

  const normalizedSrc = String(src ?? '')
    .trim()
    .toLowerCase();
  return /\.(mp4|mov|m4v|webm|avi|mkv|ogv|ogg)(?:\?|#|$)/u.test(normalizedSrc);
};

export const OverlayScene: React.FC<{
  scene: TimelineScene;
  frame: number;
  fps: number;
  width: number;
  height: number;
  isShort: boolean;
  fontFamily: string;
}> = ({ scene, frame, fps, width, height, isShort, fontFamily }) => {
  const resolvedOverlay = normalizeOverlaySettings(scene.overlaySettings);
  const backgroundImageSrc =
    resolvedOverlay.backgroundMode === 'image' && scene.imageSrc
      ? resolveMediaSrc(scene.imageSrc)
      : null;
  const backgroundVideoSrc =
    resolvedOverlay.backgroundMode === 'video' && scene.overlayBackgroundVideoSrc
      ? resolveMediaSrc(scene.overlayBackgroundVideoSrc)
      : null;
  const overlaySrc = scene.overlaySrc ? resolveMediaSrc(scene.overlaySrc) : null;
  const overlayIsVideo = inferOverlayIsVideo(scene.overlaySrc, scene.overlayMimeType);
  const shouldUseImageTabSizing = usesImageTabSizedOverlay(resolvedOverlay);
  const shouldUseLegacyCenteredTransform =
    shouldUseImageTabSizing && usesLegacyOverlayTransformDefaults(resolvedOverlay);
  const cycleFrames = Math.max(
    1,
    Math.round(clampNumber(7 / (resolvedOverlay.speed ?? 1), 2.4, 14) * fps),
  );
  const phase = ((frame % cycleFrames) / cycleFrames) * Math.PI * 2;
  const floatYOffset = shouldUseImageTabSizing ? 0 : Math.sin(phase) * 0.8;
  const floatRotation = shouldUseImageTabSizing
    ? 0
    : Math.sin(phase + Math.PI / 2) * 1.25;
  const overlayWidthPx = width * ((resolvedOverlay.widthPercent ?? 26) / 100);
  const overlayHeightPx = height * ((resolvedOverlay.heightPercent ?? 22) / 100);
  const resolvedLook = normalizeImageFilterSettings(
    scene.imageFilterSettings,
    scene.visualEffect ?? null,
  );
  const backgroundMediaFilter = buildImageLookFilter(resolvedLook);
  const lightingSeed = mulberry32((scene.index + 1) * 4409)();
  const lightingX = ((lightingSeed * 320) % 100 + 100) % 100;
  const lightingY = (35 + 25 * Math.sin(lightingSeed * 8) + 100) % 100;
  const lightingAlpha =
    (0.22 + 0.1 * Math.sin(lightingSeed * 12)) * resolvedLook.animatedLightingIntensity;
  const glassOverlayOpacity = clampNumber(resolvedLook.glassOverlayOpacity, 0, 0.4);
  const animatedLightingOn = resolvedLook.animatedLightingIntensity > 0.001;
  const glassOverlayOn = glassOverlayOpacity > 0.001;

  const textScene: TimelineScene = {
    ...scene,
    mediaType: 'text',
    imageSrc: undefined,
    videoSrc: undefined,
    textBackgroundVideoSrc: undefined,
    overlaySrc: undefined,
    overlayBackgroundVideoSrc: undefined,
    overlaySettings: undefined,
    imageFilterSettings: undefined,
    visualEffect: null,
    textAnimationSettings: {
      ...(scene.textAnimationSettings &&
      typeof scene.textAnimationSettings === 'object' &&
      !Array.isArray(scene.textAnimationSettings)
        ? scene.textAnimationSettings
        : {}),
      backgroundMode: 'solid',
      backgroundColor: 'transparent',
      backgroundDim: 0,
    },
  };

  const textLayer = resolvedOverlay.includeText ? (
    <AbsoluteFill>
      <TextScene
        scene={textScene}
        frame={frame}
        fps={fps}
        width={width}
        height={height}
        isShort={isShort}
        fontFamily={fontFamily}
      />
    </AbsoluteFill>
  ) : null;

  return (
    <AbsoluteFill style={{ backgroundColor: '#020617', overflow: 'hidden' }}>
      {resolvedOverlay.backgroundMode === 'image' || resolvedOverlay.backgroundMode === 'video' ? (
        <AbsoluteFill style={{ filter: backgroundMediaFilter }}>
          {resolvedOverlay.backgroundMode === 'image' && backgroundImageSrc ? (
            <Img
              src={backgroundImageSrc}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : null}

          {resolvedOverlay.backgroundMode === 'video' && backgroundVideoSrc ? (
            <OffthreadVideo
              src={backgroundVideoSrc}
              muted
              loop
              pauseWhenBuffering
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : null}

          {animatedLightingOn ? (
            <AbsoluteFill
              style={{
                opacity: Math.max(0, Math.min(0.42, lightingAlpha)),
                mixBlendMode: 'screen',
                background: `radial-gradient(circle at ${lightingX.toFixed(2)}% ${lightingY.toFixed(2)}%, rgba(255, 80, 200, 0.55) 0%, rgba(80, 160, 255, 0.30) 38%, rgba(0,0,0,0) 70%)`,
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
              }}
            />
          ) : null}
        </AbsoluteFill>
      ) : null}

      {resolvedOverlay.backgroundMode === 'solid' ? (
        <AbsoluteFill
          style={{ backgroundColor: resolvedOverlay.backgroundColor ?? '#020617' }}
        />
      ) : null}

      {resolvedOverlay.backgroundMode === 'gradient' ? (
        <AbsoluteFill
          style={{
            backgroundImage: `linear-gradient(${(
              resolvedOverlay.gradientAngleDeg ?? 135
            ).toFixed(0)}deg, ${resolvedOverlay.gradientFrom ?? '#020617'} 0%, ${
              resolvedOverlay.gradientTo ?? '#1d4ed8'
            } 100%)`,
            backgroundColor: resolvedOverlay.gradientFrom ?? '#020617',
          }}
        />
      ) : null}

      <AbsoluteFill
        style={{
          background: 'rgba(0, 0, 0, 0.15)',
        }}
      />

      {resolvedOverlay.includeText && resolvedOverlay.textLayer === 'below' ? (
        <AbsoluteFill style={{ zIndex: 10 }}>{textLayer}</AbsoluteFill>
      ) : null}

      {overlaySrc ? (
        <div
          style={{
            position: 'absolute',
            ...(shouldUseImageTabSizing
              ? {
                  inset: 0,
                }
              : {
                  left: width / 2 + ((resolvedOverlay.offsetX ?? 0) / 100) * width,
                  top: height / 2 + ((resolvedOverlay.offsetY ?? 0) / 100) * height,
                  width: overlayWidthPx,
                  height: overlayHeightPx,
                  marginLeft: -overlayWidthPx / 2,
                  marginTop: -overlayHeightPx / 2,
                }),
            opacity: resolvedOverlay.opacity ?? 1,
            transform: shouldUseImageTabSizing
              ? shouldUseLegacyCenteredTransform
                ? undefined
                : `translate(${(resolvedOverlay.offsetX ?? 0).toFixed(2)}%, ${(resolvedOverlay.offsetY ?? 0).toFixed(2)}%) scale(${(
                    resolvedOverlay.scale ?? 1
                  ).toFixed(4)}) rotate(${(
                    (resolvedOverlay.rotationDeg ?? 0) + floatRotation
                  ).toFixed(2)}deg)`
              : `translateY(${floatYOffset.toFixed(2)}%) scale(${(
                  resolvedOverlay.scale ?? 1
                ).toFixed(4)}) rotate(${(
                  (resolvedOverlay.rotationDeg ?? 0) + floatRotation
                ).toFixed(2)}deg)`,
            transformOrigin: 'center center',
            zIndex: 20,
          }}
        >
          {overlayIsVideo ? (
            <OffthreadVideo
              src={overlaySrc}
              muted
              loop
              pauseWhenBuffering
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                objectFit: shouldUseImageTabSizing ? 'cover' : 'contain',
              }}
            />
          ) : (
            <Img
              src={overlaySrc}
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                objectFit: shouldUseImageTabSizing ? 'cover' : 'contain',
              }}
            />
          )}
        </div>
      ) : null}

      {resolvedOverlay.includeText && resolvedOverlay.textLayer === 'above' ? (
        <AbsoluteFill style={{ zIndex: 30 }}>{textLayer}</AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};