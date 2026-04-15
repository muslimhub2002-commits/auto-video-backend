import React from 'react';
import { AbsoluteFill, Easing, Img, OffthreadVideo, interpolate } from 'remotion';
import type {
  TextAnimationEffect,
  TextAnimationSettings,
  TimelineScene,
} from '../types';
import { IMAGE_ZOOM_PER_SECOND } from '../constants';
import { resolveMediaSrc } from '../utils/media';
import { mulberry32 } from '../utils/random';

const TEXT_ANIMATION_EFFECT_VALUES: readonly TextAnimationEffect[] = [
  'slideCutFast',
];

const LEGACY_TEXT_ANIMATION_EFFECT_VALUES = [
  'popInBounceHook',
  'scalePunchZoom',
  'maskReveal',
  'glitchFlashHook',
  'kineticTypography',
] as const;

const DEFAULT_TEXT_ANIMATION_SPEED = 1.1;
const MAX_TEXT_ANIMATION_WORDS = 5;
const DEFAULT_IMAGE_MOTION_SPEED = 1.2;
const LANDSCAPE_IMAGE_MOTION_SPEED = 0.5;
const TEXT_ANIMATION_SPEED_MIN = 0.4;
const TEXT_ANIMATION_SPEED_MAX = 2.4;
const DEFAULT_TEXT_ANIMATION_WORD_DELAY = 0.08;
const TEXT_ANIMATION_WORD_DELAY_MIN = 0.03;
const TEXT_ANIMATION_WORD_DELAY_MAX = 0.4;

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

const getColor = (value: unknown, fallback: string) => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const getEnumValue = <TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
  fallback: TValue,
) => {
  return allowed.includes(value as TValue) ? (value as TValue) : fallback;
};

const getWords = (value: string) =>
  String(value ?? '')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);

const resolveLegacyTextAnimationEffect = (
  value: unknown,
): TextAnimationEffect | null => {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  if ((TEXT_ANIMATION_EFFECT_VALUES as readonly string[]).includes(normalized)) {
    return normalized as TextAnimationEffect;
  }
  if ((LEGACY_TEXT_ANIMATION_EFFECT_VALUES as readonly string[]).includes(normalized)) {
    return 'slideCutFast';
  }
  return null;
};

const getDefaultTextAnimationText = (sentenceText?: string | null) =>
  getWords(String(sentenceText ?? ''))
    .slice(0, MAX_TEXT_ANIMATION_WORDS)
    .join(' ')
    .trim();

const resolveTextAnimationText = (
  value: string | null | undefined,
  sentenceText?: string | null,
) => {
  const normalized = String(value ?? '').trim();
  if (normalized) {
    return normalized;
  }

  return getDefaultTextAnimationText(sentenceText);
};

const getDefaultBackgroundMotionSpeed = (isShortVideo: boolean) =>
  isShortVideo ? DEFAULT_IMAGE_MOTION_SPEED : LANDSCAPE_IMAGE_MOTION_SPEED;

const isTextAnimationEffect = (value: unknown): value is TextAnimationEffect => {
  return TEXT_ANIMATION_EFFECT_VALUES.includes(value as TextAnimationEffect);
};

const getDefaultTextAnimationSettings = (
  effect: TextAnimationEffect,
  isShortVideo: boolean,
): TextAnimationSettings => {
  const normalizedEffect = resolveLegacyTextAnimationEffect(effect) ?? 'slideCutFast';
  const baseFontSize = isShortVideo ? 13.2 : 8.6;
  return {
    presetKey: normalizedEffect,
    speed: DEFAULT_TEXT_ANIMATION_SPEED,
    horizontalAlign: 'left',
    contentAlign: 'left',
    verticalAlign: 'top',
    offsetX: -5,
    offsetY: -14,
    fontSizePercent: baseFontSize,
    maxWidthPercent: isShortVideo ? 72 : 46,
    fontWeight: 820,
    letterSpacingEm: 0.02,
    lineHeight: 0.92,
    textColor: '#ffffff',
    accentColor: '#22d3ee',
    strokeColor: '#0f172a',
    strokeWidthPx: 0,
    shadowOpacity: 0.34,
    shadowBlurPx: 18,
    backgroundMode: 'inheritImage',
    backgroundColor: '#0f172a',
    gradientFrom: '#0f172a',
    gradientTo: '#1d4ed8',
    gradientAngleDeg: 135,
    backgroundDim: 0.44,
    animationIntensity: 0.92,
    animatePerWord: false,
    wordDelaySeconds: DEFAULT_TEXT_ANIMATION_WORD_DELAY,
    textCase: 'uppercase',
  };
};

const normalizeTextAnimationSettings = (
  settings: TimelineScene['textAnimationSettings'],
  fallbackEffect: TextAnimationEffect,
  isShortVideo: boolean,
): TextAnimationSettings => {
  const defaults = getDefaultTextAnimationSettings(
    resolveLegacyTextAnimationEffect(fallbackEffect) ?? 'slideCutFast',
    isShortVideo,
  );

  return {
    presetKey:
      resolveLegacyTextAnimationEffect(settings?.presetKey) ?? defaults.presetKey,
    speed: getNumeric(settings?.speed, defaults.speed ?? DEFAULT_TEXT_ANIMATION_SPEED, 0.4, 2.4),
    horizontalAlign: getEnumValue(
      settings?.horizontalAlign,
      ['left', 'center', 'right'],
      defaults.horizontalAlign ?? 'center',
    ),
    contentAlign: getEnumValue(
      settings?.contentAlign,
      ['left', 'center', 'right'],
      defaults.contentAlign ?? defaults.horizontalAlign ?? 'left',
    ),
    verticalAlign: getEnumValue(
      settings?.verticalAlign,
      ['top', 'middle', 'bottom'],
      defaults.verticalAlign ?? 'middle',
    ),
    offsetX: getNumeric(settings?.offsetX, defaults.offsetX ?? 0, -35, 35),
    offsetY: getNumeric(settings?.offsetY, defaults.offsetY ?? 0, -35, 35),
    fontSizePercent: getNumeric(
      settings?.fontSizePercent,
      defaults.fontSizePercent ?? 12,
      5,
      24,
    ),
    maxWidthPercent: getNumeric(
      settings?.maxWidthPercent,
      defaults.maxWidthPercent ?? 76,
      30,
      100,
    ),
    fontWeight: getNumeric(settings?.fontWeight, defaults.fontWeight ?? 800, 300, 900),
    letterSpacingEm: getNumeric(
      settings?.letterSpacingEm,
      defaults.letterSpacingEm ?? 0.02,
      -0.08,
      0.24,
    ),
    lineHeight: getNumeric(settings?.lineHeight, defaults.lineHeight ?? 0.92, 0.75, 1.5),
    textColor: getColor(settings?.textColor, defaults.textColor ?? '#ffffff'),
    accentColor: getColor(settings?.accentColor, defaults.accentColor ?? '#facc15'),
    strokeColor: getColor(settings?.strokeColor, defaults.strokeColor ?? '#0f172a'),
    strokeWidthPx: getNumeric(settings?.strokeWidthPx, defaults.strokeWidthPx ?? 0, 0, 8),
    shadowOpacity: getNumeric(settings?.shadowOpacity, defaults.shadowOpacity ?? 0.34, 0, 1),
    shadowBlurPx: getNumeric(settings?.shadowBlurPx, defaults.shadowBlurPx ?? 18, 0, 48),
    backgroundMode: getEnumValue(
      settings?.backgroundMode,
      ['inheritImage', 'image', 'inheritVideo', 'video', 'solid', 'gradient'],
      defaults.backgroundMode ?? 'inheritImage',
    ),
    backgroundColor: getColor(settings?.backgroundColor, defaults.backgroundColor ?? '#0f172a'),
    gradientFrom: getColor(settings?.gradientFrom, defaults.gradientFrom ?? '#0f172a'),
    gradientTo: getColor(settings?.gradientTo, defaults.gradientTo ?? '#1d4ed8'),
    gradientAngleDeg: getNumeric(
      settings?.gradientAngleDeg,
      defaults.gradientAngleDeg ?? 135,
      0,
      360,
    ),
    backgroundDim: getNumeric(settings?.backgroundDim, defaults.backgroundDim ?? 0.38, 0, 0.92),
    animationIntensity: getNumeric(
      settings?.animationIntensity,
      defaults.animationIntensity ?? 0.82,
      0,
      1.2,
    ),
    animatePerWord: settings?.animatePerWord === true,
    wordDelaySeconds: getNumeric(
      settings?.wordDelaySeconds,
      defaults.wordDelaySeconds ?? DEFAULT_TEXT_ANIMATION_WORD_DELAY,
      TEXT_ANIMATION_WORD_DELAY_MIN,
      TEXT_ANIMATION_WORD_DELAY_MAX,
    ),
    textCase: getEnumValue(
      settings?.textCase,
      ['original', 'uppercase'],
      defaults.textCase ?? 'uppercase',
    ),
  };
};

const resolveJustifyContent = (
  alignment: NonNullable<TextAnimationSettings['horizontalAlign']>,
) => {
  if (alignment === 'left') return 'flex-start';
  if (alignment === 'right') return 'flex-end';
  return 'center';
};

const resolveAlignItems = (
  alignment: NonNullable<TextAnimationSettings['verticalAlign']>,
) => {
  if (alignment === 'top') return 'flex-start';
  if (alignment === 'bottom') return 'flex-end';
  return 'center';
};

const formatDisplayText = (
  value: string,
  textCase: NonNullable<TextAnimationSettings['textCase']>,
) => {
  return textCase === 'uppercase' ? value.toUpperCase() : value;
};

const resolveContentTextAlign = (settings: TextAnimationSettings) => {
  return settings.contentAlign ?? settings.horizontalAlign ?? 'left';
};

const getAnimationFrames = (fps: number, speed: number) => {
  const normalizedSpeed = clampNumber(
    speed,
    TEXT_ANIMATION_SPEED_MIN,
    TEXT_ANIMATION_SPEED_MAX,
  );
  const durationMs = Math.max(1200, 3600 / normalizedSpeed);
  return Math.max(10, Math.round((durationMs / 1000) * fps));
};

const getWordDelayFrames = (fps: number, settings: TextAnimationSettings) => {
  const delaySeconds = getNumeric(
    settings.wordDelaySeconds,
    DEFAULT_TEXT_ANIMATION_WORD_DELAY,
    TEXT_ANIMATION_WORD_DELAY_MIN,
    TEXT_ANIMATION_WORD_DELAY_MAX,
  );
  return Math.max(1, Math.round(delaySeconds * fps));
};

const buildBackgroundStyle = (
  settings: TextAnimationSettings,
  renderBackgroundMedia: boolean,
): React.CSSProperties => {
  if (renderBackgroundMedia) {
    return { backgroundColor: '#020617' };
  }

  if (settings.backgroundMode === 'gradient') {
    return {
      backgroundImage: `linear-gradient(${(settings.gradientAngleDeg ?? 135).toFixed(0)}deg, ${settings.gradientFrom}, ${settings.gradientTo})`,
      backgroundColor: settings.gradientFrom,
    };
  }

  return {
    backgroundColor: settings.backgroundColor,
  };
};

const getDefaultImageFilterSettings = (
  effect: TimelineScene['visualEffect'] | null | undefined,
) => {
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

const getAnimatedBlockStyle = (params: {
  effect: TextAnimationEffect;
  frame: number;
  introFrames: number;
  animationIntensity: number;
}): React.CSSProperties => {
  const progress = clampNumber(params.frame / params.introFrames, 0, 1);
  const easedProgress = interpolate(progress, [0, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.12, 0.88, 0.24, 1),
  });
  const leadDistance = 20 + params.animationIntensity * 8;
  const skewStart = -7 - params.animationIntensity * 4;
  const blurStart = 8 + params.animationIntensity * 8;
  const translateXPercent = interpolate(easedProgress, [0, 1], [-leadDistance, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const clipRight = interpolate(easedProgress, [0, 1], [100, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const skew = interpolate(easedProgress, [0, 1], [skewStart, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const blurPx = interpolate(easedProgress, [0, 0.40, 1], [blurStart, 0.6, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return {
    opacity: interpolate(easedProgress, [0, 0.18, 1], [0, 1, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
    transform: `translate3d(${translateXPercent.toFixed(2)}%, 0, 0) skewX(${skew.toFixed(2)}deg)`,
    clipPath: `inset(0 ${clipRight.toFixed(2)}% 0 0)`,
    filter: `blur(${blurPx.toFixed(2)}px)`,
  };
};

export const TextScene: React.FC<{
  scene: TimelineScene;
  frame: number;
  fps: number;
  width: number;
  height: number;
  isShort: boolean;
  fontFamily: string;
}> = ({ scene, frame, fps, width, height, isShort, fontFamily }) => {
  const resolvedEffect =
    resolveLegacyTextAnimationEffect(scene.textAnimationEffect) ?? 'slideCutFast';
  const resolvedSettings = normalizeTextAnimationSettings(
    scene.textAnimationSettings,
    resolvedEffect,
    isShort,
  );
  const resolvedText = formatDisplayText(
    resolveTextAnimationText(scene.textAnimationText, scene.text),
    resolvedSettings.textCase ?? 'uppercase',
  );
  const words = getWords(resolvedText);
  const animatePerWord = resolvedSettings.animatePerWord === true && words.length > 1;
  const introFrames = getAnimationFrames(
    fps,
    resolvedSettings.speed ?? DEFAULT_TEXT_ANIMATION_SPEED,
  );
  const wordDelayFrames = getWordDelayFrames(fps, resolvedSettings);
  const animationIntensity = resolvedSettings.animationIntensity ?? 0.82;
  const renderBackgroundImage =
    Boolean(String(scene.imageSrc ?? '').trim()) &&
    (resolvedSettings.backgroundMode === 'inheritImage' ||
      resolvedSettings.backgroundMode === 'image');
  const renderBackgroundVideo =
    Boolean(String(scene.textBackgroundVideoSrc ?? '').trim()) &&
    (resolvedSettings.backgroundMode === 'inheritVideo' ||
      resolvedSettings.backgroundMode === 'video');
  const backgroundImageSrc = renderBackgroundImage
    ? resolveMediaSrc(String(scene.imageSrc))
    : null;
  const backgroundVideoSrc = renderBackgroundVideo
    ? resolveMediaSrc(String(scene.textBackgroundVideoSrc))
    : null;
  const hasBackgroundMedia = Boolean(backgroundImageSrc || backgroundVideoSrc);
  const resolvedLook = normalizeImageFilterSettings(
    scene.imageFilterSettings,
    scene.visualEffect ?? null,
  );
  const backgroundMediaFilter = buildImageLookFilter(resolvedLook);
  const backgroundScale = hasBackgroundMedia
    ? clampNumber(
        1 + (Math.max(0, frame) / fps) * IMAGE_ZOOM_PER_SECOND * getDefaultBackgroundMotionSpeed(isShort),
        0.5,
        2,
      )
    : 1;
  const backgroundStyle = buildBackgroundStyle(
    resolvedSettings,
    hasBackgroundMedia,
  );
  const fontSizePx = Math.min(width, height) * ((resolvedSettings.fontSizePercent ?? 12) / 100);
  const maxWidthPx = width * ((resolvedSettings.maxWidthPercent ?? 76) / 100);
  const strokeWidthPx = resolvedSettings.strokeWidthPx ?? 0;
  const containerPadding = Math.round(Math.min(width, height) * 0.07);
  const contentAlign = resolveContentTextAlign(resolvedSettings);
  const animatedBlockStyle = getAnimatedBlockStyle({
    effect: resolvedEffect,
    frame,
    introFrames,
    animationIntensity,
  });
  const animatedLightingOn = resolvedLook.animatedLightingIntensity > 0.001;
  const lightingSeed = mulberry32((scene.index + 1) * 4409)();
  const lightingX = ((lightingSeed * 320) % 100 + 100) % 100;
  const lightingY = (35 + 25 * Math.sin(lightingSeed * 8) + 100) % 100;
  const lightingAlpha =
    (0.22 + 0.1 * Math.sin(lightingSeed * 12)) * resolvedLook.animatedLightingIntensity;
  const glassOverlayOpacity = clampNumber(resolvedLook.glassOverlayOpacity, 0, 0.4);
  const glassOverlayOn = glassOverlayOpacity > 0.001;

  const baseTextStyle: React.CSSProperties = {
    color: resolvedSettings.textColor,
    fontWeight: resolvedSettings.fontWeight,
    fontSize: `${fontSizePx.toFixed(2)}px`,
    lineHeight: String(resolvedSettings.lineHeight ?? 0.92),
    letterSpacing: `${(resolvedSettings.letterSpacingEm ?? 0.02).toFixed(3)}em`,
    textAlign: contentAlign,
    maxWidth: `${maxWidthPx.toFixed(2)}px`,
    fontFamily,
    textShadow: `0 ${(6 + animationIntensity * 6).toFixed(1)}px ${(resolvedSettings.shadowBlurPx ?? 18).toFixed(1)}px rgba(2, 6, 23, ${(resolvedSettings.shadowOpacity ?? 0.34).toFixed(3)})`,
    WebkitTextStroke:
      strokeWidthPx > 0
        ? `${strokeWidthPx.toFixed(2)}px ${resolvedSettings.strokeColor}`
        : undefined,
    paintOrder: 'stroke fill',
    whiteSpace: 'pre-wrap',
  };

  return (
    <AbsoluteFill style={{ ...backgroundStyle, overflow: 'hidden' }}>
      {hasBackgroundMedia ? (
        <AbsoluteFill style={{ filter: backgroundMediaFilter }}>
          {backgroundVideoSrc ? (
            <OffthreadVideo
              src={backgroundVideoSrc}
              muted
              loop
              pauseWhenBuffering
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: `scale(${backgroundScale.toFixed(6)})`,
                transformOrigin: '50% 50%',
              }}
            />
          ) : null}

          {backgroundImageSrc ? (
            <Img
              src={backgroundImageSrc}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: `scale(${backgroundScale.toFixed(6)})`,
                transformOrigin: '50% 50%',
              }}
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

      {hasBackgroundMedia ? (
        <AbsoluteFill
          style={{
            background: `linear-gradient(180deg, rgba(2, 6, 23, ${((resolvedSettings.backgroundDim ?? 0.38) * 0.85).toFixed(3)}) 0%, rgba(2, 6, 23, ${(resolvedSettings.backgroundDim ?? 0.38).toFixed(3)}) 100%)`,
          }}
        />
      ) : null}

      <AbsoluteFill
        style={{
          flexDirection: 'row',
          justifyContent: resolveJustifyContent(
            resolvedSettings.horizontalAlign ?? 'center',
          ),
          alignItems: resolveAlignItems(
            resolvedSettings.verticalAlign ?? 'middle',
          ),
          padding: containerPadding,
          transform: `translate(${(resolvedSettings.offsetX ?? 0).toFixed(1)}%, ${(resolvedSettings.offsetY ?? 0).toFixed(1)}%)`,
        }}
      >
        <div
          style={{
            ...baseTextStyle,
            ...(animatePerWord ? null : animatedBlockStyle),
          }}
        >
          {animatePerWord
            ? words.map((word, index) => {
                const wordFrame = Math.max(0, frame - index * wordDelayFrames);
                const animatedWordStyle = getAnimatedBlockStyle({
                  effect: resolvedEffect,
                  frame: wordFrame,
                  introFrames,
                  animationIntensity,
                });

                return (
                  <span key={`${word}-${index}`}>
                    <span
                      style={{
                        display: 'inline-block',
                        color:
                          index === 0
                            ? resolvedSettings.accentColor
                            : resolvedSettings.textColor,
                        ...animatedWordStyle,
                      }}
                    >
                      {word}
                    </span>
                    {index < words.length - 1 ? ' ' : null}
                  </span>
                );
              })
            : (
              <>
                <span style={{ color: resolvedSettings.accentColor }}>
                  {words[0] ?? resolvedText}
                </span>
                {words.length > 1 ? ` ${words.slice(1).join(' ')}` : ''}
              </>
            )}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
