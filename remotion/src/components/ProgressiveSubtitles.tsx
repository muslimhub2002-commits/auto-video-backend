import React from 'react';
import { AbsoluteFill, Easing, interpolate } from 'remotion';
import type { TimelineScene } from '../types';

const SUBTITLE_COLORS = ['#ffd60a', '#ffffff'];

const hashText = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
};

const getSubtitleColor = (text: string) => {
  const normalized = String(text ?? '').trim().toLowerCase();
  if (!normalized) return SUBTITLE_COLORS[0];

  return SUBTITLE_COLORS[hashText(normalized) % SUBTITLE_COLORS.length];
};

const hexToRgba = (hex: string, alpha: number) => {
  const normalized = hex.replace('#', '');
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : normalized;

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

export const getActiveSubtitleText = (
  words: NonNullable<TimelineScene['subtitleWords']>,
  frame: number,
) => {
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = words[index];
    if (frame >= word.startFrame && frame < word.endFrame) {
      return word.text.trim();
    }
  }

  return '';
};

const getActiveSubtitleStartFrame = (
  words: NonNullable<TimelineScene['subtitleWords']>,
  frame: number,
) => {
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = words[index];
    if (frame >= word.startFrame && frame < word.endFrame) {
      return word.startFrame;
    }
  }

  return 0;
};

export const ProgressiveSubtitles: React.FC<{
  text: string;
  subtitleWords?: TimelineScene['subtitleWords'];
  frame: number;
  fontScale: number;
  isShort: boolean;
  fontFamily: string;
}> = ({ text, subtitleWords, frame, fontScale, isShort, fontFamily }) => {
  const resolvedWords = Array.isArray(subtitleWords) ? subtitleWords : [];
  const visibleText = resolvedWords.length
    ? getActiveSubtitleText(resolvedWords, frame)
    : String(text ?? '').trim();
  const activeStartFrame = resolvedWords.length
    ? getActiveSubtitleStartFrame(resolvedWords, frame)
    : 0;
  const color = getSubtitleColor(visibleText);
  const glowColor = hexToRgba(color, 0.38);
  const animationFrame = Math.max(0, frame - activeStartFrame);
  const animatedOpacity = interpolate(animationFrame, [0, 4], [0.55, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const animatedScale = interpolate(animationFrame, [0, 5], [0.9, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.back(1.4)),
  });
  const animatedTranslateY = interpolate(animationFrame, [0, 5], [10, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  if (!visibleText) return null;

  return (
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
          padding: '18px 22px',
          borderRadius: 18,
          fontSize: 100 * fontScale,
          fontWeight: 700,
          fontFamily,
          lineHeight: 1.15,
          marginBottom: isShort ? '400px' : '10px',
          textAlign: 'center',
          textShadow: `0 2px 10px rgba(0,0,0,0.55), 0 0 8px ${glowColor}`,
          filter: `drop-shadow(0 0 6px ${glowColor})`,
          WebkitTextStroke: '3px rgba(0,0,0,0.92)',
          paintOrder: 'stroke fill',
          transform: `translateY(${animatedTranslateY.toFixed(2)}px) scale(${animatedScale.toFixed(3)})`,
          color,
          opacity: animatedOpacity,
        }}
      >
        {visibleText}
      </div>
    </AbsoluteFill>
  );
};