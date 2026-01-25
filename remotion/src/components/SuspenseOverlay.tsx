import React from 'react';
import { AbsoluteFill } from 'remotion';

export type SuspenseOverlayProps = {
  frame: number;
  jitterX: number;
  scratchAlpha: number;
  verticalGlitchAlpha: number;
  bandOn: boolean;
  bandX: number;
  bandW: number;
  hardPulse: number;
  scratchPulse: number;
  spliceOn: boolean;
  spliceX: number;
  suspenseFlicker: number;
  softPulse: number;
};

export const SuspenseOverlay: React.FC<SuspenseOverlayProps> = React.memo(
  ({
    frame,
    jitterX,
    scratchAlpha,
    verticalGlitchAlpha,
    bandOn,
    bandX,
    bandW,
    hardPulse,
    scratchPulse,
    spliceOn,
    spliceX,
    suspenseFlicker,
    softPulse,
  }) => {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        {/* Vignette */}
        <AbsoluteFill
          style={{
            background:
              'radial-gradient(circle at 50% 45%, rgba(0,0,0,0) 35%, rgba(0,0,0,0.78) 100%)',
            opacity: 0.7,
          }}
        />

        {/* Grain */}
        <AbsoluteFill
          style={{
            backgroundImage: `url("data:image/svg+xml;utf8,
            <svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>
              <filter id='n'>
                <feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4'/>
                <feColorMatrix type='saturate' values='0'/>
              </filter>
              <rect width='100%' height='100%' filter='url(%23n)'/>
            </svg>")`,
            opacity: Math.max(0, 0.12 + suspenseFlicker),
            mixBlendMode: 'overlay',
          }}
        />

        {/* Animated scratch shimmer */}
        <AbsoluteFill
          style={{
            backgroundImage: `url("data:image/svg+xml;utf8,
            <svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'>
              <filter id='s'>
                <feTurbulence type='turbulence' baseFrequency='0.02 0.65' numOctaves='1' seed='7'/>
                <feColorMatrix type='matrix' values='
                  1 0 0 0 0
                  0 1 0 0 0
                  0 0 1 0 0
                  0 0 0 2.2 -0.65
                '/>
              </filter>
              <rect width='100%' height='100%' filter='url(%23s)'/>
            </svg>")`,
            backgroundSize: '220px 220px',
            backgroundPosition: `${Math.round(frame * 1.7)}px ${Math.round(frame * 6.5)}px`,
            opacity: scratchAlpha,
            mixBlendMode: 'screen',
            filter: 'contrast(1.15) brightness(1.05)',
          }}
        />

        {/* Dense vertical line glitches */}
        <AbsoluteFill
          style={{
            backgroundImage:
              'repeating-linear-gradient(to right, rgba(255,255,255,0.14) 0px, rgba(255,255,255,0.14) 1px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 6px),'
              + 'repeating-linear-gradient(to right, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 1px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 14px),'
              + 'repeating-linear-gradient(to right, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 28px)',
            backgroundPosition: `${Math.round(frame * 3.2)}px 0px, ${Math.round(-frame * 1.7)}px 0px, ${Math.round(frame * 0.6)}px 0px`,
            opacity: verticalGlitchAlpha,
            mixBlendMode: 'screen',
            filter: 'contrast(1.32) brightness(1.10)',
            transform: `translateX(${jitterX.toFixed(2)}px)`,
          }}
        />

        {/* Disturbing tear band */}
        {bandOn ? (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: bandX,
              width: bandW,
              background:
                'linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(255,255,255,0.95) 18%, rgba(255,255,255,0.08) 52%, rgba(255,255,255,0.85) 82%, rgba(0,0,0,0) 100%)',
              opacity: Math.max(0, Math.min(1, 0.18 + 0.65 * hardPulse)),
              mixBlendMode: 'difference',
              filter: 'blur(0.35px) contrast(1.4)',
              transform: `translateX(${(jitterX * 1.35).toFixed(2)}px)`,
            }}
          />
        ) : null}

        {/* Occasional extra-bright splice line */}
        {spliceOn ? (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: spliceX,
              width: 2,
              background:
                'linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 20%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.55) 80%, rgba(255,255,255,0) 100%)',
              opacity: Math.max(0, Math.min(1, 0.55 + 0.55 * hardPulse + 0.20 * scratchPulse)),
              mixBlendMode: 'screen',
              filter: 'blur(0.35px) contrast(1.25)',
            }}
          />
        ) : null}

        {/* Vertical scratches */}
        <AbsoluteFill
          style={{
            background:
              'repeating-linear-gradient(to right, rgba(255,255,255,0.10) 0px, rgba(255,255,255,0.10) 1px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 8px),'
              + 'repeating-linear-gradient(to right, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 2px, rgba(0,0,0,0) 3px, rgba(0,0,0,0) 22px),'
              + 'linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.22) 1%, rgba(255,255,255,0) 2%)',
            backgroundSize: 'auto, auto, 340px 100%',
            backgroundPosition: `${Math.round(frame * 2.4)}px 0px, ${Math.round(-frame * 1.1)}px 0px, ${Math.round(80 + (frame * 5.2) % 340)}px 0px`,
            opacity: Math.max(
              0,
              Math.min(
                1,
                0.14 +
                  suspenseFlicker * 1.35 +
                  0.22 * scratchPulse +
                  0.28 * softPulse +
                  0.20 * hardPulse,
              ),
            ),
            mixBlendMode: 'screen',
            filter: 'contrast(1.12) brightness(1.04)',
          }}
        />

        {/* Horizontal dust lines */}
        <AbsoluteFill
          style={{
            background:
              'repeating-linear-gradient(to bottom, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px, rgba(0,0,0,0) 5px, rgba(0,0,0,0) 13px)',
            opacity: 0.08,
            mixBlendMode: 'soft-light',
          }}
        />

        {/* Dust specks */}
        <AbsoluteFill
          style={{
            backgroundImage: `url("data:image/svg+xml;utf8,
            <svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'>
              <filter id='d'>
                <feTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='3' seed='11'/>
                <feColorMatrix type='matrix' values='
                  1 0 0 0 0
                  0 1 0 0 0
                  0 0 1 0 0
                  0 0 0 3 -1.4
                '/>
              </filter>
              <rect width='100%' height='100%' filter='url(%23d)'/>
            </svg>")`,
            backgroundSize: '260px 260px',
            backgroundPosition: `${Math.round(-frame * 0.9)}px ${Math.round(frame * 1.4)}px`,
            opacity: Math.max(
              0,
              Math.min(1, 0.08 + 0.03 * Math.sin(frame * 0.8) + 0.12 * scratchPulse),
            ),
            mixBlendMode: 'soft-light',
          }}
        />

        {/* Brighter streaks */}
        <AbsoluteFill
          style={{
            background:
              'linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.14) 8%, rgba(255,255,255,0) 16%),\
                 linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.10) 6%, rgba(255,255,255,0) 12%)',
            backgroundSize: '180px 100%, 260px 100%',
            backgroundPosition: `${Math.round(40 + (frame * 3.3) % 180)}px 0px, ${Math.round(120 + (frame * 2.1) % 260)}px 0px`,
            opacity: Math.max(0, Math.min(1, 0.06 + 0.25 * scratchPulse)),
            mixBlendMode: 'screen',
          }}
        />
      </AbsoluteFill>
    );
  },
);

SuspenseOverlay.displayName = 'SuspenseOverlay';
