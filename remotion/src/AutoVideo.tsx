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
// Set to 0 to avoid any constant “camera motion”.
const IMAGE_ZOOM_PER_SECOND = 0;

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

// Production note:
// In production (Remotion Lambda), prefer passing CDN/Cloudinary/S3 URLs via `timeline.assets`.
// If not provided, we fall back to local `staticFile()` assets in `remotion/public`.
const DEFAULT_BACKGROUND_MUSIC_SRC = 'background_3.mp3';
const DEFAULT_GLITCH_FX_URL = 'glitch-fx.mp3';
const DEFAULT_WHOOSH_SFX_URL = 'whoosh.mp3';
const DEFAULT_CAMERA_CLICK_SFX_URL = 'camera_click.mp3';
const DEFAULT_SUSPENSE_GLITCH_SFX_URL = 'suspense-glitch.mp3';

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

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

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

  const isSuspenseOpening = scene.index === 0 && Boolean(scene.isSuspense);
  const suspenseFilter = isSuspenseOpening
    ? 'grayscale(1) contrast(1.38) brightness(0.88)'
    : undefined;

  // Subtle film flicker for the suspense opening.
  const suspenseFlicker = isSuspenseOpening
    ? 0.02 + 0.02 * Math.sin(frame * 0.9) + 0.012 * Math.sin(frame * 2.7)
    : 0;

  // Occasional scratch "pop" (deterministic) to mimic film damage.
  const scratchRand = mulberry32((scene.index + 1) * 881 + frame * 131)();
  const scratchPulse = isSuspenseOpening ? clamp01((scratchRand - 0.92) * 16) : 0;
  const scratchAlpha = isSuspenseOpening
    ? clamp01(0.14 + suspenseFlicker + 0.62 * scratchPulse)
    : 0;

  // Vertical line glitch pulses (deterministic). Two-tier:
  // - softPulse: common, low-intensity disturbance
  // - hardPulse: rare, very visible “disturbing” glitch bursts
  const vRand = mulberry32((scene.index + 1) * 1907 + frame * 73)();
  // Make lines appear more often by lowering thresholds.
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

  // Add a tiny overlay-only jitter during hard pulses (keeps media still).
  const jitterSeed = (scene.index + 1) * 7129 + frame * 11;
  const jitterX = isSuspenseOpening
    ? (mulberry32(jitterSeed)() * 2 - 1) * 10 * hardPulse
    : 0;

  // Wide "tear band" parameters (visible + disturbing).
  const bandSeed = (scene.index + 1) * 9029 + Math.floor(frame / 2) * 37;
  const bandX = Math.round(mulberry32(bandSeed)() * (width - 40));
  // Keep the “tear” narrower so it reads like thin line glitches, not a wide wash.
  const bandW = Math.round(18 + mulberry32(bandSeed ^ 0x9e3779b9)() * 72);
  const bandOn = isSuspenseOpening && hardPulse > 0.08;

  // A rare, bright “splice” line (static position for a few frames) to sell film damage.
  const spliceOn = isSuspenseOpening && (hardPulse > 0.35 || scratchPulse > 0.7);
  const spliceXSeed = (scene.index + 1) * 3331 + Math.floor(frame / 3) * 97;
  const spliceX = Math.round(mulberry32(spliceXSeed)() * (width - 6));

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
        <AbsoluteFill style={{ ...backgroundStyle, filter: suspenseFilter }}>
          <OffthreadVideo
            src={resolveMediaSrc(scene.videoSrc)}
            muted
            pauseWhenBuffering
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </AbsoluteFill>
      ) : (
        scene.imageSrc && (
          <AbsoluteFill style={{ ...backgroundStyle, filter: suspenseFilter }}>
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

      {/* Suspense opening: black & white movie overlay */}
      {isSuspenseOpening ? (
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

          {/* Animated scratch shimmer (more "film" than static lines) */}
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

          {/* Dense vertical line glitches (multi-layer) */}
          <AbsoluteFill
            style={{
              backgroundImage:
                // Thinner linework: mostly 1px lines with tighter spacing.
                'repeating-linear-gradient(to right, rgba(255,255,255,0.14) 0px, rgba(255,255,255,0.14) 1px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 6px),'
                + 'repeating-linear-gradient(to right, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 1px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 14px),'
                + 'repeating-linear-gradient(to right, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 28px)',
              backgroundPosition: `${Math.round(frame * 3.2)}px 0px, ${Math.round(
                -frame * 1.7,
              )}px 0px, ${Math.round(frame * 0.6)}px 0px`,
              opacity: verticalGlitchAlpha,
              mixBlendMode: 'screen',
              filter: 'contrast(1.32) brightness(1.10)',
              transform: `translateX(${jitterX.toFixed(2)}px)`,
            }}
          />

          {/* Disturbing tear band (difference blend) */}
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
                opacity: clamp01(0.18 + 0.65 * hardPulse),
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
                opacity: clamp01(0.55 + 0.55 * hardPulse + 0.20 * scratchPulse),
                mixBlendMode: 'screen',
                filter: 'blur(0.35px) contrast(1.25)',
              }}
            />
          ) : null}

          {/* Vertical scratches */}
          <AbsoluteFill
            style={{
              background:
                // Multiple vertical line “glitches” (thin + medium + occasional brighter lines)
                'repeating-linear-gradient(to right, rgba(255,255,255,0.10) 0px, rgba(255,255,255,0.10) 1px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 8px),'
                + 'repeating-linear-gradient(to right, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 2px, rgba(0,0,0,0) 3px, rgba(0,0,0,0) 22px),'
                + 'linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.22) 1%, rgba(255,255,255,0) 2%)',
              backgroundSize: 'auto, auto, 340px 100%',
              backgroundPosition: `${Math.round(frame * 2.4)}px 0px, ${Math.round(
                -frame * 1.1,
              )}px 0px, ${Math.round(80 + (frame * 5.2) % 340)}px 0px`,
              opacity: clamp01(
                0.14 + suspenseFlicker * 1.35 + 0.22 * scratchPulse + 0.28 * softPulse + 0.20 * hardPulse,
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

          {/* Dust specks (small, drifting) */}
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
              opacity: clamp01(0.08 + 0.03 * Math.sin(frame * 0.8) + 0.12 * scratchPulse),
              mixBlendMode: 'soft-light',
            }}
          />

          {/* A few brighter streaks that flicker in and out (film damage) */}
          <AbsoluteFill
            style={{
              background:
                'linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.14) 8%, rgba(255,255,255,0) 16%),\
                 linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.10) 6%, rgba(255,255,255,0) 12%)',
              backgroundSize: '180px 100%, 260px 100%',
              backgroundPosition: `${Math.round(40 + (frame * 3.3) % 180)}px 0px, ${Math.round(
                120 + (frame * 2.1) % 260,
              )}px 0px`,
              opacity: clamp01(0.06 + 0.25 * scratchPulse),
              mixBlendMode: 'screen',
            }}
          />
        </AbsoluteFill>
      ) : null}

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
            marginBottom: '150px',
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
  const backgroundMusicSrc =
    timeline.assets?.backgroundMusicSrc ?? DEFAULT_BACKGROUND_MUSIC_SRC;
  const glitchSfxSrc = timeline.assets?.glitchSfxSrc ?? DEFAULT_GLITCH_FX_URL;
  const whooshSfxSrc = timeline.assets?.whooshSfxSrc ?? DEFAULT_WHOOSH_SFX_URL;
  const cameraClickSfxSrc =
    timeline.assets?.cameraClickSfxSrc ?? DEFAULT_CAMERA_CLICK_SFX_URL;
  const chromaLeakSfxSrc = timeline.assets?.chromaLeakSfxSrc ?? '';
  const suspenseGlitchSfxSrc =
    timeline.assets?.suspenseGlitchSfxSrc ?? DEFAULT_SUSPENSE_GLITCH_SFX_URL;

  const isVertical = timeline.height > timeline.width;
  const baseHeight = isVertical ? 1920 : 1080;
  const fontScale = Math.max(0.5, Math.min(1, timeline.height / baseHeight));
  const voiceOverVolume = 1; // +0.5 louder than the 0.5 background track (max 1.0)
  const suspenseOpeningScene = timeline.scenes[0];
  const isSuspenseOpening = Boolean(suspenseOpeningScene?.isSuspense);
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

    // Global background music + transition SFX (either remote URLs or staticFile()).
    if (backgroundMusicSrc) sources.add(resolveMediaSrc(backgroundMusicSrc));
    if (glitchSfxSrc) sources.add(resolveMediaSrc(glitchSfxSrc));
    if (whooshSfxSrc) sources.add(resolveMediaSrc(whooshSfxSrc));
    if (chromaLeakSfxSrc) sources.add(resolveMediaSrc(chromaLeakSfxSrc));
    if (cameraClickSfxSrc) sources.add(resolveMediaSrc(cameraClickSfxSrc));
    if (isSuspenseOpening && suspenseGlitchSfxSrc) {
      sources.add(resolveMediaSrc(suspenseGlitchSfxSrc));
    }

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
        <Html5Audio src={resolveMediaSrc(timeline.audioSrc)} volume={voiceOverVolume} />
      )}
      {backgroundMusicSrc ? (
        <Audio src={resolveMediaSrc(backgroundMusicSrc)} volume={0.5} />
      ) : null}

      {/* Suspense opening SFX: plays once and stops when audio ends (or at end of scene). */}
      {isSuspenseOpening && suspenseOpeningScene ? (
        <Sequence
          from={suspenseOpeningScene.startFrame}
          durationInFrames={suspenseOpeningScene.durationFrames}
        >
          {suspenseGlitchSfxSrc ? (
            <Audio src={resolveMediaSrc(suspenseGlitchSfxSrc)} volume={0.2} />
          ) : null}
        </Sequence>
      ) : null}

      {/* Glitch SFX only during image->image cut windows */}
      {timeline.scenes.map((next, idx) => {
        if (idx === 0) return null;
        const prevIndex = timeline.scenes[idx - 1].index;
        const transition = cutTransitions[idx] ?? 'none';
        if (transition !== 'glitch') return null;
        if (!glitchSfxSrc) return null;

        const from = Math.max(0, next.startFrame - GLITCH_EDGE_FRAMES);

        return (
          <Sequence
            key={`glitch-sfx-${prevIndex}-${next.index}`}
            from={from}
          >
            <Audio src={resolveMediaSrc(glitchSfxSrc)} volume={0.9} />
          </Sequence>
        );
      })}

      {/* Whoosh SFX only during whip image->image cut windows */}
      {timeline.scenes.map((next, idx) => {
        if (idx === 0) return null;
        const prevIndex = timeline.scenes[idx - 1].index;
        const transition = cutTransitions[idx] ?? 'none';
        if (transition !== 'whip') return null;
        if (!whooshSfxSrc) return null;

        const from = Math.max(0, next.startFrame - WHIP_EDGE_FRAMES - 10);

        return (
          <Sequence
            key={`whoosh-sfx-${prevIndex}-${next.index}`}
            from={from}
          >
            <Audio src={resolveMediaSrc(whooshSfxSrc)} volume={0.85} />
          </Sequence>
        );
      })}

      {/* Camera click SFX only during flash image->image cut windows */}
      {timeline.scenes.map((next, idx) => {
        if (idx === 0) return null;
        const prevIndex = timeline.scenes[idx - 1].index;
        const transition = cutTransitions[idx] ?? 'none';
        if (transition !== 'flash') return null;
        if (!cameraClickSfxSrc) return null;

        // Trigger right on the cut.
        const from = Math.max(0, next.startFrame - 8);

        return (
          <Sequence
            key={`flash-sfx-${prevIndex}-${next.index}`}
            from={from}
          >
            <Audio src={resolveMediaSrc(cameraClickSfxSrc)} volume={0.9} />
          </Sequence>
        );
      })}

      {/* Chroma leak SFX only during chromaLeak image->image cut windows */}
      {timeline.scenes.map((next, idx) => {
        if (idx === 0) return null;
        const prevIndex = timeline.scenes[idx - 1].index;
        const transition = cutTransitions[idx] ?? 'none';
        if (transition !== 'chromaLeak') return null;
        if (!chromaLeakSfxSrc) return null;

        const from = Math.max(0, next.startFrame - CHROMA_EDGE_FRAMES - 8);

        return (
          <Sequence key={`chroma-sfx-${prevIndex}-${next.index}`} from={from}>
            <Audio src={resolveMediaSrc(chromaLeakSfxSrc)} volume={0.9} />
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


