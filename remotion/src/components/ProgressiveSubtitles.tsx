import React from 'react';
import { AbsoluteFill } from 'remotion';
import type { TimelineScene } from '../types';

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
          color: 'white',
          padding: '18px 22px',
          borderRadius: 18,
          fontSize: 80 * fontScale,
          fontWeight: 700,
          fontFamily,
          lineHeight: 1.15,
          marginBottom: isShort ? '400px' : '10px',
          textAlign: 'center',
          textShadow: '0 2px 10px rgba(0,0,0,0.55)',
          opacity: 1,
        }}
      >
        {visibleText}
      </div>
    </AbsoluteFill>
  );
};