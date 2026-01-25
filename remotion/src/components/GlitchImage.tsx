import React from 'react';
import { AbsoluteFill, Img } from 'remotion';
import { GLITCH_EDGE_FRAMES } from '../constants';
import { mulberry32 } from '../utils/random';

type GlitchParams = {
  intensity: number;
  rX: number;
  rY: number;
  bX: number;
  bY: number;
  slices: Array<{ topPct: number; heightPct: number; dx: number }>;
};

const makeGlitchParams = (seed: number): GlitchParams => {
  const rand = mulberry32(seed);
  const intensity = 0.6 + rand() * 0.8; // 0.6..1.4

  const rX = (rand() * 2 - 1) * 16 * intensity;
  const rY = (rand() * 2 - 1) * 6 * intensity;
  const bX = (rand() * 2 - 1) * 16 * intensity;
  const bY = (rand() * 2 - 1) * 6 * intensity;

  const slicesCount = 4 + Math.floor(rand() * 4); // 4..7
  const slices: GlitchParams['slices'] = [];
  for (let i = 0; i < slicesCount; i += 1) {
    const topPct = rand() * 92;
    const heightPct = 2 + rand() * 10;
    const dx = (rand() * 2 - 1) * 60 * intensity;
    slices.push({ topPct, heightPct, dx });
  }

  return { intensity, rX, rY, bX, bY, slices };
};

export const GlitchImage: React.FC<{
  src: string;
  style: React.CSSProperties;
  frame: number;
  durationFrames: number;
  seedStart: number;
  seedEnd: number;
  enableStart: boolean;
  enableEnd: boolean;
}> = React.memo(
  ({
    src,
    style,
    frame,
    durationFrames,
    seedStart,
    seedEnd,
    enableStart,
    enableEnd,
  }) => {
    const shouldStart = enableStart && frame >= 0 && frame < GLITCH_EDGE_FRAMES;
    const shouldEnd = enableEnd && frame >= durationFrames - GLITCH_EDGE_FRAMES;
    const active = shouldStart || shouldEnd;
    if (!active) {
      return <Img src={src} style={style} />;
    }

    const seed = shouldStart ? seedStart : seedEnd;
    if (!seed) {
      return <Img src={src} style={style} />;
    }

    const p = makeGlitchParams(seed);
    // Ramp in/out a bit so it's not a single-frame pop.
    const edgeProgress =
      frame < GLITCH_EDGE_FRAMES
        ? (frame + 1) / GLITCH_EDGE_FRAMES
        : Math.max(0, (durationFrames - frame) / GLITCH_EDGE_FRAMES);
    const alpha = Math.max(0, Math.min(1, edgeProgress));

    return (
      <AbsoluteFill>
        {/* Base – unstable contrast */}
        <Img
          src={src}
          style={{
            ...style,
            filter: `contrast(${1 + 0.2 * p.intensity}) saturate(${1 + 0.15 * p.intensity})`,
          }}
        />

        {/* RED channel – stretched & misaligned */}
        <AbsoluteFill style={{ opacity: 0.7 * alpha, mixBlendMode: 'screen' }}>
          <Img
            src={src}
            style={{
              ...style,
              transform: `
          ${style.transform ?? ''}
          translate(${p.rX * 2.2}px, ${p.rY * 0.6}px)
          scaleX(${1 + 0.015 * p.intensity})
          skewX(${p.rX * 0.15}deg)
        `,
              filter: `
          contrast(${1.35 + 0.4 * p.intensity})
          saturate(1.6)
          hue-rotate(-18deg)
        `,
            }}
          />
        </AbsoluteFill>

        {/* BLUE channel – delayed & drifting */}
        <AbsoluteFill style={{ opacity: 0.6 * alpha, mixBlendMode: 'screen' }}>
          <Img
            src={src}
            style={{
              ...style,
              transform: `
          ${style.transform ?? ''}
          translate(${p.bX * 2.6}px, ${p.bY * 1.3}px)
          scaleY(${1 + 0.02 * p.intensity})
        `,
              filter: `
          contrast(${1.3 + 0.35 * p.intensity})
          saturate(1.45)
          hue-rotate(22deg)
        `,
            }}
          />
        </AbsoluteFill>

        {/* Slice jitter – harsher & uneven */}
        {p.slices.map((s, i) => (
          <AbsoluteFill
            key={i}
            style={{
              clipPath: `inset(${s.topPct}% 0% ${Math.max(0, 100 - (s.topPct + s.heightPct))}% 0%)`,
              transform: `
          translateX(${s.dx * 2.4 * alpha}px)
          skewX(${s.dx * 0.35}deg)
          scaleX(${1 + Math.abs(s.dx) * 0.004})
        `,
              opacity: 0.5 * alpha,
            }}
          >
            <Img
              src={src}
              style={{
                ...style,
                filter: `
            contrast(${1.4})
            brightness(${0.85 + 0.35 * p.intensity})
          `,
              }}
            />
          </AbsoluteFill>
        ))}

        {/* Pseudo vertical tear using slices (no new params) */}
        {p.slices.slice(0, 2).map((s, i) => (
          <AbsoluteFill
            key={`tear-${i}`}
            style={{
              clipPath: `inset(0 ${60 - s.dx * 2}% 0 0)`,
              transform: `translateX(${s.dx * 6 * alpha}px)`,
              opacity: 0.35 * alpha,
            }}
          >
            <Img
              src={src}
              style={{
                ...style,
                filter: `brightness(${0.8 + 0.25 * p.intensity})`,
              }}
            />
          </AbsoluteFill>
        ))}

        {/* Scanlines */}
        <AbsoluteFill
          style={{
            background: `repeating-linear-gradient(
        to bottom,
        rgba(0,0,0,0.45) 0px,
        rgba(0,0,0,0.45) 1px,
        transparent 2px,
        transparent 4px
      )`,
            opacity: 0.25 + 0.2 * p.intensity,
            mixBlendMode: 'overlay',
          }}
        />

        {/* Noise grain */}
        <AbsoluteFill
          style={{
            backgroundImage: `url("data:image/svg+xml;utf8,
        <svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'>
          <filter id='n'>
            <feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/>
          </filter>
          <rect width='100%' height='100%' filter='url(%23n)'/>
        </svg>")`,
            opacity: 0.12 + 0.15 * p.intensity,
            mixBlendMode: 'overlay',
          }}
        />
      </AbsoluteFill>
    );
  },
);

GlitchImage.displayName = 'GlitchImage';
