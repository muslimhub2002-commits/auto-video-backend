import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Html5Audio,
  Img,
  OffthreadVideo,
  Sequence,
  delayRender,
  continueRender,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Easing,
  staticFile,
} from 'remotion';
import type { Timeline, TimelineScene } from './types';

// Linear zoom rate. Example: 0.04 means +4% scale per second.
const IMAGE_ZOOM_PER_SECOND = 0.008;

// Transition window: last 4 frames of outgoing image + first 4 frames of incoming image.
const GLITCH_EDGE_FRAMES = 4;

// Camera flash transition: a bright flash around the cut.
// Applies to the last/first N frames (no overlap required).
const FLASH_EDGE_FRAMES = 5;

// Fade transition: fade-to-black in/out around the cut.
// Applies to the last/first N frames (no overlap required).
const FADE_EDGE_FRAMES = 12;

// Whip-pan transition: fast pan + motion blur around the cut.
// This applies to the last/first N frames (no overlap required).
const WHIP_EDGE_FRAMES = 10;
const WHIP_DISTANCE_MULTIPLIER = 1.15; // fraction of frame width
const WHIP_MAX_BLUR_PX = 18;

// VR Chroma Leaks transition: RGB channel separation + light leak around the cut.
// Applies to the last/first N frames (no overlap required).
const CHROMA_EDGE_FRAMES = 10;
const CHROMA_MAX_SHIFT_PX = 22;
const CHROMA_MAX_BLUR_PX = 6;

const preloadImage = (src: string) =>
  new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = src;
  });

const preloadAudio = (src: string) =>
  new Promise<void>((resolve) => {
    const audio = document.createElement('audio');
    const done = () => resolve();
    audio.preload = 'auto';
    audio.oncanplaythrough = done;
    audio.onloadedmetadata = done;
    audio.onerror = done;
    audio.src = src;
    // Some browsers require calling load() to start fetching.
    audio.load();
  });

const preloadVideo = (src: string) =>
  new Promise<void>((resolve) => {
    const video = document.createElement('video');
    const done = () => resolve();
    video.preload = 'auto';
    video.onloadeddata = done;
    video.onloadedmetadata = done;
    video.onerror = done;
    video.src = src;
    video.load();
  });

// These assets are expected to be present in the Remotion `publicDir` (downloaded by backend).
const BACKGROUND_MUSIC_SRC = 'audio/background_3.mp3';
const GLITCH_FX_URL = 'sfx/glitch.mp3';
const WHOOSH_SFX_URL = 'sfx/whoosh.mp3';
const CAMERA_CLICK_SFX_URL = 'sfx/camera_click.mp3';
const CHROMA_LEAK_SFX_URL = 'sfx/chroma_leak.mp3';

type TransitionType = 'none' | 'glitch' | 'whip' | 'flash' | 'fade' | 'chromaLeak';

type GlitchParams = {
  intensity: number;
  rX: number;
  rY: number;
  bX: number;
  bY: number;
  slices: Array<{ topPct: number; heightPct: number; dx: number }>;
};

// Deterministic pseudo-random generator (mulberry32) so renders are stable.
const mulberry32 = (seed: number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
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

const isImageGlitchFrame = (frame: number, durationFrames: number) => {
  if (durationFrames <= 0) return false;
  const isInStart = frame >= 0 && frame < GLITCH_EDGE_FRAMES;
  const isInEnd = frame >= durationFrames - GLITCH_EDGE_FRAMES;
  return isInStart || isInEnd;
};

const GlitchImage: React.FC<{
  src: string;
  style: React.CSSProperties;
  frame: number;
  durationFrames: number;
  seedStart: number;
  seedEnd: number;
  enableStart: boolean;
  enableEnd: boolean;
}> = ({
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
            clipPath: `inset(${s.topPct}% 0% ${Math.max(0, 100 - (s.topPct + s.heightPct))
              }% 0%)`,
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
};

const resolveMediaSrc = (src: string) => {
  if (!src) return src;
  // If we already have an absolute URL (e.g. Cloudinary), use it as-is.
  if (/^https?:\/\//i.test(src)) return src;
  return staticFile(src.replace(/^\/+/, ''));
};

const isImageToImageCut = (prev?: TimelineScene, next?: TimelineScene) => {
  return (
    !!prev?.imageSrc &&
    !prev?.videoSrc &&
    !!next?.imageSrc &&
    !next?.videoSrc
  );
};

const getCutSeed = (prev: TimelineScene, next: TimelineScene) => {
  return (prev.index + 1) * 1009 + (next.index + 1) * 9176;
};

const shuffleInPlace = <T,>(arr: T[], rand: () => number) => {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
};

// Transition plan per cut index (i = cut from scenes[i-1] -> scenes[i]).
// Rules:
// - Glitch happens ONLY on first and last eligible image->image cut.
// - Other transitions don't repeat until all have been used once.
const buildCutTransitions = (scenes: TimelineScene[]): TransitionType[] => {
  const transitions: TransitionType[] = new Array(scenes.length).fill('none');
  if (scenes.length < 2) return transitions;

  const eligibleCuts: number[] = [];
  for (let i = 1; i < scenes.length; i += 1) {
    if (isImageToImageCut(scenes[i - 1], scenes[i])) eligibleCuts.push(i);
  }
  if (eligibleCuts.length === 0) return transitions;

  const firstCut = eligibleCuts[0];
  const lastCut = eligibleCuts[eligibleCuts.length - 1];
  transitions[firstCut] = 'glitch';
  if (lastCut !== firstCut) transitions[lastCut] = 'glitch';

  // The second transition of the video (first non-glitch eligible cut) must not be fade.
  const firstNonGlitchCut = eligibleCuts.find(
    (c) => c !== firstCut && c !== lastCut,
  );

  const pool: TransitionType[] = ['whip', 'flash', 'fade', 'chromaLeak'];
  if (pool.length === 0) return transitions;

  // Deterministic shuffle seed for this timeline.
  const seed = (scenes.length * 1337) ^ getCutSeed(scenes[0], scenes[scenes.length - 1]);
  const rand = mulberry32(seed);

  let bag = shuffleInPlace([...pool], rand);
  let bagIdx = 0;
  let reshuffleCount = 1; // initial shuffle
  let lastUsed: TransitionType | null = null;

  const ensureNextIsNotFade = () => {
    if (bag[bagIdx] !== 'fade') return;
    // Swap with the next non-fade element if possible (deterministic, no extra randomness).
    for (let j = bagIdx + 1; j < bag.length; j += 1) {
      if (bag[j] !== 'fade') {
        const tmp = bag[bagIdx];
        bag[bagIdx] = bag[j];
        bag[j] = tmp;
        return;
      }
    }
  };

  for (const cutIndex of eligibleCuts) {
    if (cutIndex === firstCut || cutIndex === lastCut) continue;

    if (bagIdx >= bag.length) {
      bag = shuffleInPlace([...pool], rand);
      bagIdx = 0;
      reshuffleCount += 1;

      // Extra rule: on the *second* reshuffle, don't let the next pick be `fade`.
      // (Keeps the early pacing snappier.)
      if (reshuffleCount === 2 && bag.length > 1 && bag[0] === 'fade') {
        bag.push(bag.shift() as TransitionType);
      }

      // Optional: avoid immediate repeat across cycle boundary.
      if (lastUsed && bag.length > 1 && bag[0] === lastUsed) {
        bag.push(bag.shift() as TransitionType);
      }
    }

    if (firstNonGlitchCut && cutIndex === firstNonGlitchCut) {
      ensureNextIsNotFade();
    }

    const t = bag[bagIdx];
    bagIdx += 1;
    transitions[cutIndex] = t;
    lastUsed = t;
  }

  return transitions;
};

const pickWhipDirection = (prev: TimelineScene, next: TimelineScene) => {
  // +1 = move right, -1 = move left
  const r = mulberry32(getCutSeed(prev, next) ^ 0x9e3779b9)();
  return r < 0.5 ? 1 : -1;
};

const getChromaParams = (seed: number) => {
  const rand = mulberry32(seed ^ 0x7f4a7c15);
  const dirX = rand() < 0.5 ? -1 : 1;
  const dirY = rand() < 0.5 ? -1 : 1;
  const strength = 0.85 + rand() * 0.5; // 0.85..1.35
  const originX = 20 + rand() * 60; // 20%..80%
  const originY = 20 + rand() * 50; // 20%..70%
  return { dirX, dirY, strength, originX, originY };
};

const Scene: React.FC<{
  scene: TimelineScene;
  fontScale: number;
  index: number;
  transitionFromPrev: TransitionType;
  transitionToNext: TransitionType;
  seedFromPrev: number;
  seedToNext: number;
  whipDirFromPrev: number;
  whipDirToNext: number;
}> = ({
  scene,
  fontScale,
  index,
  transitionFromPrev,
  transitionToNext,
  seedFromPrev,
  seedToNext,
  whipDirFromPrev,
  whipDirToNext,
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  // Inside a <Sequence>, useCurrentFrame() is already relative to the Sequence start.
  // Clamp to 0 to ensure each scene starts at default scale.
  const elapsedSeconds = Math.max(0, frame) / fps;

  // Base media layer (effects applied below).
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

  // Whip-pan: translate strongly + apply blur (blur correlates with speed).
  const whipEasing = Easing.inOut(Easing.cubic);
  const panDistance = width * WHIP_DISTANCE_MULTIPLIER;

  const hasWhipIn = transitionFromPrev === 'whip' && frame < WHIP_EDGE_FRAMES;
  const hasWhipOut =
    transitionToNext === 'whip' &&
    frame >= scene.durationFrames - WHIP_EDGE_FRAMES;

  const xIn = hasWhipIn
    ? interpolate(
        frame,
        [0, WHIP_EDGE_FRAMES],
        [-whipDirFromPrev * panDistance, 0],
        {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: whipEasing,
        },
      )
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

  const baseScale = 1 + IMAGE_ZOOM_PER_SECOND * elapsedSeconds;
  const whipSkew = (whipBlur / WHIP_MAX_BLUR_PX) * 6 * (whipX >= 0 ? 1 : -1);

  imageStyle.transform = `translateX(${whipX.toFixed(2)}px) skewX(${whipSkew.toFixed(
    2,
  )}deg) scale(${baseScale.toFixed(6)})`;
  imageStyle.willChange = 'transform, filter';
  imageStyle.filter =
    whipBlur > 0.01
      ? `blur(${whipBlur.toFixed(2)}px) contrast(1.08) saturate(1.04)`
      : undefined;

  // Camera-flash overlay alpha.
  const hasFlashIn = transitionFromPrev === 'flash' && frame < FLASH_EDGE_FRAMES;
  const hasFlashOut =
    transitionToNext === 'flash' &&
    frame >= scene.durationFrames - FLASH_EDGE_FRAMES;

  // Important: avoid a 1-frame dip around the cut.
  // - Incoming scene: start at full flash on frame 0, decay to 0.
  // - Outgoing scene: ramp up to full flash on the LAST frame, so the cut is hidden.
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

  // Fade-to-black overlay alpha.
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

  // VR Chroma Leaks: RGB split + light leak around the cut.
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

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {scene.videoSrc ? (
        <AbsoluteFill style={backgroundStyle}>
          <OffthreadVideo
            src={resolveMediaSrc(scene.videoSrc)}
            muted
            pauseWhenBuffering
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </AbsoluteFill>
      ) : (
        scene.imageSrc && (
          <AbsoluteFill style={backgroundStyle}>
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

            {/* Chroma leak overlays (only during edge frames) */}
            {chroma && chromaAlpha > 0.001 ? (
              <>
                <AbsoluteFill style={{ opacity: 0.6 * chromaAlpha, mixBlendMode: 'screen' }}>
                  <Img
                    src={resolveMediaSrc(scene.imageSrc)}
                    style={{
                      ...imageStyle,
                      transform: `${imageStyle.transform ?? ''} translate(${(
                        chroma.dirX * chromaShift
                      ).toFixed(2)}px, ${(-chroma.dirY * chromaShift * 0.35).toFixed(2)}px)`,
                      filter: `blur(${chromaBlur.toFixed(2)}px) saturate(1.4) hue-rotate(-18deg) contrast(1.12)`,
                    }}
                  />
                </AbsoluteFill>

                <AbsoluteFill style={{ opacity: 0.5 * chromaAlpha, mixBlendMode: 'screen' }}>
                  <Img
                    src={resolveMediaSrc(scene.imageSrc)}
                    style={{
                      ...imageStyle,
                      transform: `${imageStyle.transform ?? ''} translate(${(
                        -chroma.dirX * chromaShift * 1.15
                      ).toFixed(2)}px, ${(chroma.dirY * chromaShift * 0.45).toFixed(2)}px)`,
                      filter: `blur(${(chromaBlur * 0.9).toFixed(2)}px) saturate(1.25) hue-rotate(24deg) contrast(1.1)`,
                    }}
                  />
                </AbsoluteFill>

                {/* Light leak bloom */}
                <AbsoluteFill
                  style={{
                    opacity: 0.55 * chromaAlpha,
                    mixBlendMode: 'screen',
                    background: `radial-gradient(circle at ${chroma.originX}% ${chroma.originY}%, rgba(255, 80, 200, 0.55) 0%, rgba(80, 160, 255, 0.30) 35%, rgba(0,0,0,0) 68%)`,
                  }}
                />
                <AbsoluteFill
                  style={{
                    opacity: 0.25 * chromaAlpha,
                    mixBlendMode: 'screen',
                    background:
                      'linear-gradient(120deg, rgba(255,0,170,0) 0%, rgba(255,0,170,0.22) 40%, rgba(80,160,255,0.18) 65%, rgba(0,0,0,0) 100%)',
                  }}
                />
              </>
            ) : null}
          </AbsoluteFill>
        )
      )}
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
            // background: 'rgba(0,0,0,0.55)',
            color: 'white',
            padding: '18px 22px',
            borderRadius: 18,
            fontSize: 55 * fontScale,
            fontWeight: 700,
            fontFamily: 'Oswald, system-ui, sans-serif',
            lineHeight: 1.15,
            marginBottom: '125px',
            textAlign: 'center',
            textShadow: '0 2px 10px rgba(0,0,0,0.55)',
            opacity: 1,
          }}
        >
          {scene.text}
        </div>
      </AbsoluteFill>

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
};

export const AutoVideo: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const isVertical = timeline.height > timeline.width;
  const baseHeight = isVertical ? 1920 : 1080;
  const fontScale = Math.max(0.5, Math.min(1, timeline.height / baseHeight));
  const cutTransitions = React.useMemo(
    () => buildCutTransitions(timeline.scenes),
    [timeline.scenes],
  );

  // Preload remote media so we don't show the black background while assets fetch.
  const preloadHandle = React.useMemo(
    () => delayRender('preload-media'),
    [],
  );

  React.useEffect(() => {
    let cancelled = false;
    let didContinue = false;

    const safeContinue = () => {
      if (didContinue) return;
      didContinue = true;
      continueRender(preloadHandle);
    };

    const sources = new Set<string>();

    if (timeline.audioSrc) sources.add(resolveMediaSrc(timeline.audioSrc));

    // Global background music + transition SFX (served locally via staticFile()).
    sources.add(resolveMediaSrc(BACKGROUND_MUSIC_SRC));
    sources.add(resolveMediaSrc(GLITCH_FX_URL));
    sources.add(resolveMediaSrc(WHOOSH_SFX_URL));
    sources.add(resolveMediaSrc(CHROMA_LEAK_SFX_URL));
    sources.add(resolveMediaSrc(CAMERA_CLICK_SFX_URL));

    for (const scene of timeline.scenes) {
      if (scene.imageSrc) sources.add(resolveMediaSrc(scene.imageSrc));
      if (scene.videoSrc) sources.add(resolveMediaSrc(scene.videoSrc));
    }

    const run = async () => {
      const tasks = Array.from(sources).map((src) => {
        const lower = src.toLowerCase();
        if (lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.m4a')) {
          return preloadAudio(src);
        }
        if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov')) {
          return preloadVideo(src);
        }
        return preloadImage(src);
      });

      await Promise.allSettled(tasks);

      if (!cancelled) safeContinue();
    };

    // Safety net: never hang rendering forever if a remote host is slow.
    const timeout = setTimeout(() => {
      if (!cancelled) safeContinue();
    }, 15000);

    run().finally(() => clearTimeout(timeout));

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      // If React remounts/unmounts quickly (e.g. StrictMode), ensure we never
      // leave a delayRender handle unresolved which would hang rendering.
      safeContinue();
    };
  }, [preloadHandle, timeline]);


  return (
    <AbsoluteFill>
      {timeline.audioSrc && (
        <Html5Audio src={resolveMediaSrc(timeline.audioSrc)} />
      )}
      <Audio src={resolveMediaSrc(BACKGROUND_MUSIC_SRC)} volume={0.4} />

      {/* Glitch SFX only during image->image cut windows */}
      {timeline.scenes.map((next, idx) => {
        if (idx === 0) return null;
        const prevIndex = timeline.scenes[idx - 1].index;
        const transition = cutTransitions[idx] ?? 'none';
        if (transition !== 'glitch') return null;

        const from = Math.max(0, next.startFrame - GLITCH_EDGE_FRAMES);

        return (
          <Sequence
            key={`glitch-sfx-${prevIndex}-${next.index}`}
            from={from}
          >
            <Audio src={resolveMediaSrc(GLITCH_FX_URL)} volume={0.9} />
          </Sequence>
        );
      })}

      {/* Whoosh SFX only during whip image->image cut windows */}
      {timeline.scenes.map((next, idx) => {
        if (idx === 0) return null;
        const prevIndex = timeline.scenes[idx - 1].index;
        const transition = cutTransitions[idx] ?? 'none';
        if (transition !== 'whip') return null;

        const from = Math.max(0, next.startFrame - WHIP_EDGE_FRAMES - 10);

        return (
          <Sequence
            key={`whoosh-sfx-${prevIndex}-${next.index}`}
            from={from}
          >
            <Audio src={resolveMediaSrc(WHOOSH_SFX_URL)} volume={0.85} />
          </Sequence>
        );
      })}

      {/* Camera click SFX only during flash image->image cut windows */}
      {timeline.scenes.map((next, idx) => {
        if (idx === 0) return null;
        const prevIndex = timeline.scenes[idx - 1].index;
        const transition = cutTransitions[idx] ?? 'none';
        if (transition !== 'flash') return null;

        // Trigger right on the cut.
        const from = Math.max(0, next.startFrame - 8);

        return (
          <Sequence
            key={`flash-sfx-${prevIndex}-${next.index}`}
            from={from}
          >
            <Audio src={resolveMediaSrc(CAMERA_CLICK_SFX_URL)} volume={0.9} />
          </Sequence>
        );
      })}

      {/* Chroma leak SFX only during chromaLeak image->image cut windows */}
      {timeline.scenes.map((next, idx) => {
        if (idx === 0) return null;
        const prevIndex = timeline.scenes[idx - 1].index;
        const transition = cutTransitions[idx] ?? 'none';
        if (transition !== 'chromaLeak') return null;

        const from = Math.max(0, next.startFrame - CHROMA_EDGE_FRAMES - 8);

        return (
          <Sequence key={`chroma-sfx-${prevIndex}-${next.index}`} from={from}>
            <Audio src={resolveMediaSrc(CHROMA_LEAK_SFX_URL)} volume={0.9} />
          </Sequence>
        );
      })}

      {timeline.scenes.map((scene, idx) => {
        const prev = idx > 0 ? timeline.scenes[idx - 1] : null;
        const next = idx + 1 < timeline.scenes.length ? timeline.scenes[idx + 1] : null;

        const transitionFromPrev = idx > 0 ? (cutTransitions[idx] ?? 'none') : 'none';
        const transitionToNext =
          idx + 1 < timeline.scenes.length ? (cutTransitions[idx + 1] ?? 'none') : 'none';

        const seedFromPrev =
          prev && (transitionFromPrev === 'glitch' || transitionFromPrev === 'chromaLeak')
            ? getCutSeed(prev, scene)
            : 0;
        const seedToNext =
          next && (transitionToNext === 'glitch' || transitionToNext === 'chromaLeak')
            ? getCutSeed(scene, next)
            : 0;

        const whipDirFromPrev =
          prev && transitionFromPrev === 'whip' ? pickWhipDirection(prev, scene) : 1;
        const whipDirToNext =
          next && transitionToNext === 'whip' ? pickWhipDirection(scene, next) : 1;

        return (
          <Sequence
            key={scene.index}
            from={scene.startFrame}
            durationInFrames={scene.durationFrames}
          >
            <Scene
              scene={scene}
              fontScale={fontScale}
              index={idx}
              transitionFromPrev={transitionFromPrev}
              transitionToNext={transitionToNext}
              seedFromPrev={seedFromPrev}
              seedToNext={seedToNext}
              whipDirFromPrev={whipDirFromPrev}
              whipDirToNext={whipDirToNext}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};


