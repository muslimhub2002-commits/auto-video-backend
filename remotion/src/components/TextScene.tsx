import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, interpolate } from 'remotion';
import type {
  TextAnimationEffect,
  TextAnimationSettings,
  TimelineScene,
} from '../types';
import { IMAGE_ZOOM_PER_SECOND } from '../constants';
import { resolveMediaSrc } from '../utils/media';

const TEXT_ANIMATION_EFFECT_VALUES: readonly TextAnimationEffect[] = [
  'popInBounceHook',
  'slideCutFast',
  'scalePunchZoom',
  'maskReveal',
  'glitchFlashHook',
  'kineticTypography',
];

const DEFAULT_TEXT_ANIMATION_SPEED = 1.1;
const MAX_TEXT_ANIMATION_WORDS = 5;
const DEFAULT_IMAGE_MOTION_SPEED = 1.2;
const LANDSCAPE_IMAGE_MOTION_SPEED = 0.5;
const TEXT_ANIMATION_SPEED_MIN = 0.4;
const TEXT_ANIMATION_SPEED_MAX = 2.4;

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
  const baseFontSize = isShortVideo ? 13.2 : 8.6;
  const base: TextAnimationSettings = {
    speed: DEFAULT_TEXT_ANIMATION_SPEED,
    horizontalAlign: 'center',
    verticalAlign: 'middle',
    offsetX: 0,
    offsetY: 0,
    fontSizePercent: baseFontSize,
    maxWidthPercent: isShortVideo ? 76 : 58,
    fontWeight: 820,
    letterSpacingEm: 0.02,
    lineHeight: 0.92,
    textColor: '#ffffff',
    accentColor: '#facc15',
    strokeColor: '#0f172a',
    strokeWidthPx: 0,
    shadowOpacity: 0.34,
    shadowBlurPx: 18,
    backgroundMode: 'inheritImage',
    backgroundColor: '#0f172a',
    gradientFrom: '#0f172a',
    gradientTo: '#1d4ed8',
    gradientAngleDeg: 135,
    backgroundDim: 0.38,
    animationIntensity: 0.82,
    textCase: 'uppercase',
  };

  if (effect === 'slideCutFast') {
    return {
      ...base,
      presetKey: effect,
      horizontalAlign: 'left',
      verticalAlign: 'top',
      offsetX: -5,
      offsetY: -14,
      maxWidthPercent: isShortVideo ? 72 : 46,
      accentColor: '#22d3ee',
      backgroundDim: 0.44,
      animationIntensity: 0.92,
    };
  }

  if (effect === 'scalePunchZoom') {
    return {
      ...base,
      presetKey: effect,
      fontSizePercent: baseFontSize + 1.4,
      maxWidthPercent: isShortVideo ? 82 : 62,
      accentColor: '#fb7185',
      shadowOpacity: 0.44,
      shadowBlurPx: 22,
      animationIntensity: 1,
    };
  }

  if (effect === 'maskReveal') {
    return {
      ...base,
      presetKey: effect,
      verticalAlign: 'bottom',
      offsetY: 12,
      maxWidthPercent: isShortVideo ? 84 : 64,
      accentColor: '#f97316',
      backgroundDim: 0.48,
      animationIntensity: 0.76,
    };
  }

  if (effect === 'glitchFlashHook') {
    return {
      ...base,
      presetKey: effect,
      verticalAlign: 'top',
      offsetY: -9,
      fontSizePercent: baseFontSize + 1,
      accentColor: '#38bdf8',
      strokeColor: '#020617',
      strokeWidthPx: 1,
      backgroundDim: 0.58,
      animationIntensity: 1,
    };
  }

  if (effect === 'kineticTypography') {
    return {
      ...base,
      presetKey: effect,
      horizontalAlign: 'left',
      verticalAlign: 'middle',
      offsetX: -8,
      maxWidthPercent: isShortVideo ? 74 : 48,
      fontSizePercent: baseFontSize - 0.3,
      accentColor: '#a78bfa',
      letterSpacingEm: 0.05,
      lineHeight: 0.88,
      animationIntensity: 0.95,
    };
  }

  return {
    ...base,
    presetKey: effect,
  };
};

const normalizeTextAnimationSettings = (
  settings: TimelineScene['textAnimationSettings'],
  fallbackEffect: TextAnimationEffect,
  isShortVideo: boolean,
): TextAnimationSettings => {
  const defaults = getDefaultTextAnimationSettings(fallbackEffect, isShortVideo);

  return {
    presetKey:
      typeof settings?.presetKey === 'string'
        ? (settings.presetKey as TextAnimationSettings['presetKey'])
        : defaults.presetKey,
    speed: getNumeric(settings?.speed, defaults.speed ?? DEFAULT_TEXT_ANIMATION_SPEED, 0.4, 2.4),
    horizontalAlign: getEnumValue(
      settings?.horizontalAlign,
      ['left', 'center', 'right'],
      defaults.horizontalAlign ?? 'center',
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

const getAnimationFrames = (fps: number, speed: number) => {
  const normalizedSpeed = clampNumber(
    speed,
    TEXT_ANIMATION_SPEED_MIN,
    TEXT_ANIMATION_SPEED_MAX,
  );
  const durationMs = Math.max(1200, 3600 / normalizedSpeed);
  return Math.max(10, Math.round((durationMs / 1000) * fps));
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

const getAnimatedBlockStyle = (params: {
  effect: TextAnimationEffect;
  frame: number;
  introFrames: number;
}): React.CSSProperties => {
  const progress = clampNumber(params.frame / params.introFrames, 0, 1);

  if (params.effect === 'slideCutFast') {
    const translateXPercent = interpolate(progress, [0, 0.4, 1], [-18, 0, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    const clipRight = interpolate(progress, [0, 0.4, 1], [100, 16, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });

    return {
      opacity: interpolate(progress, [0, 0.08, 1], [0, 1, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
      transform: `translate3d(${translateXPercent.toFixed(2)}%, 0, 0)`,
      clipPath: `inset(0 ${clipRight.toFixed(2)}% 0 0)`,
    };
  }

  if (params.effect === 'scalePunchZoom') {
    const scale = interpolate(progress, [0, 0.3, 0.58, 1], [0.55, 1.18, 0.95, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.back(1.45)),
    });
    const rotate = interpolate(progress, [0, 0.3, 0.58, 1], [-4, 2, -1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });

    return {
      opacity: interpolate(progress, [0, 0.1, 1], [0, 1, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
      transform: `scale(${scale.toFixed(4)}) rotate(${rotate.toFixed(2)}deg)`,
    };
  }

  if (params.effect === 'maskReveal') {
    const translateYPercent = interpolate(progress, [0, 0.5, 1], [16, 0, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    const clipBottom = interpolate(progress, [0, 0.5, 1], [100, 18, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });

    return {
      opacity: interpolate(progress, [0, 0.14, 1], [0, 1, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
      transform: `translate3d(0, ${translateYPercent.toFixed(2)}%, 0)`,
      clipPath: `inset(0 0 ${clipBottom.toFixed(2)}% 0)`,
    };
  }

  if (params.effect === 'glitchFlashHook') {
    const translateXPercent = interpolate(
      progress,
      [0, 0.1, 0.22, 0.3, 1],
      [0, -2, 2, -1, 0],
      {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      },
    );
    const brightness = interpolate(
      progress,
      [0, 0.42, 1],
      [1, 1.4, 1],
      {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      },
    );

    return {
      opacity: interpolate(progress, [0, 0.1, 1], [0, 1, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
      transform: `translate3d(${translateXPercent.toFixed(2)}%, 0, 0)`,
      filter: `brightness(${brightness.toFixed(3)})`,
    };
  }

  if (params.effect === 'kineticTypography') {
    const translateXPercent = interpolate(progress, [0, 0.45, 1], [-6, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    const skew = interpolate(progress, [0, 0.45, 1], [-10, 0, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    const letterSpacingEm = interpolate(
      progress,
      [0, 0.45, 1],
      [0.22, 0.06, 0.02],
      {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      },
    );

    return {
      opacity: interpolate(progress, [0, 0.12, 1], [0, 1, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
      transform: `translate3d(${translateXPercent.toFixed(2)}%, 0, 0) skewX(${skew.toFixed(2)}deg)`,
      letterSpacing: `${letterSpacingEm.toFixed(3)}em`,
    };
  }

  const translateYPercent = interpolate(progress, [0, 0.38, 0.68, 1], [22, -5, 1.5, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scale = interpolate(progress, [0, 0.38, 0.68, 1], [0.68, 1.08, 0.98, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return {
    opacity: interpolate(progress, [0, 0.1, 1], [0, 1, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
    transform: `translate3d(0, ${translateYPercent.toFixed(2)}%, 0) scale(${scale.toFixed(4)})`,
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
  const resolvedEffect = isTextAnimationEffect(scene.textAnimationEffect)
    ? scene.textAnimationEffect
    : 'popInBounceHook';
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
  const introFrames = getAnimationFrames(
    fps,
    resolvedSettings.speed ?? DEFAULT_TEXT_ANIMATION_SPEED,
  );
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
  const firstWord = words[0] ?? resolvedText;
  const restWords = words.slice(1).join(' ');
  const fontSizePx = Math.min(width, height) * ((resolvedSettings.fontSizePercent ?? 12) / 100);
  const maxWidthPx = width * ((resolvedSettings.maxWidthPercent ?? 76) / 100);
  const strokeWidthPx = resolvedSettings.strokeWidthPx ?? 0;
  const containerPadding = Math.round(Math.min(width, height) * 0.07);
  const animatedBlockStyle = getAnimatedBlockStyle({
    effect: resolvedEffect,
    frame,
    introFrames,
  });

  const baseTextStyle: React.CSSProperties = {
    color: resolvedSettings.textColor,
    fontWeight: resolvedSettings.fontWeight,
    fontSize: `${fontSizePx.toFixed(2)}px`,
    lineHeight: String(resolvedSettings.lineHeight ?? 0.92),
    letterSpacing: `${(resolvedSettings.letterSpacingEm ?? 0.02).toFixed(3)}em`,
    textAlign: resolvedSettings.horizontalAlign,
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

  const glitchFlashOpacity =
    resolvedEffect === 'glitchFlashHook'
      ? interpolate(frame, [0, Math.max(3, introFrames * 0.18), introFrames], [0.65, 0, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 0;

  return (
    <AbsoluteFill style={{ ...backgroundStyle, overflow: 'hidden' }}>
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

      {hasBackgroundMedia ? (
        <AbsoluteFill
          style={{
            background: `linear-gradient(180deg, rgba(2, 6, 23, ${((resolvedSettings.backgroundDim ?? 0.38) * 0.85).toFixed(3)}) 0%, rgba(2, 6, 23, ${(resolvedSettings.backgroundDim ?? 0.38).toFixed(3)}) 100%)`,
          }}
        />
      ) : null}

      {resolvedEffect === 'glitchFlashHook' && glitchFlashOpacity > 0.001 ? (
        <AbsoluteFill
          style={{
            opacity: glitchFlashOpacity,
            background:
              'linear-gradient(110deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.12) 42%, rgba(255,255,255,0) 100%)',
            mixBlendMode: 'screen',
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
            ...animatedBlockStyle,
            filter:
              resolvedEffect === 'glitchFlashHook'
                ? `${String(animatedBlockStyle.filter ?? '').trim() ? `${String(animatedBlockStyle.filter ?? '').trim()} ` : ''}drop-shadow(-2px 0 0 rgba(244, 63, 94, 0.55)) drop-shadow(2px 0 0 rgba(56, 189, 248, 0.55))`
                : resolvedEffect === 'scalePunchZoom'
                  ? `drop-shadow(0 0 ${(10 + animationIntensity * 20).toFixed(0)}px ${resolvedSettings.accentColor}66)`
                  : animatedBlockStyle.filter,
          }}
        >
          <span style={{ color: resolvedSettings.accentColor }}>{firstWord}</span>
          {restWords ? ` ${restWords}` : ''}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
