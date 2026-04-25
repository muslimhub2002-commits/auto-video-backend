import type { TimelineScene } from '../types';
import { mulberry32 } from './random';

export type TransitionType =
  | 'none'
  | 'glitch'
  | 'whip'
  | 'flash'
  | 'fade'
  | 'chromaLeak'
  | 'impactZoom'
  | 'slicePush'
  | 'irisReveal'
  | 'echoStutter'
  | 'tiltSnap';

export const AUTO_CUT_TRANSITIONS: TransitionType[] = [
  'glitch',
  'whip',
  'flash',
  'fade',
  'chromaLeak',
  'impactZoom',
  'slicePush',
  'irisReveal',
  'echoStutter',
  'tiltSnap',
];

const hasVisualMedia = (scene?: TimelineScene) => {
  return Boolean(
    scene?.imageSrc ||
      scene?.videoSrc ||
      scene?.overlaySrc ||
      scene?.overlayBackgroundVideoSrc ||
      scene?.mediaType === 'text' ||
      scene?.mediaType === 'overlay',
  );
};

export const isMediaToMediaCut = (prev?: TimelineScene, next?: TimelineScene) => {
  return hasVisualMedia(prev) && hasVisualMedia(next);
};

export const getCutSeed = (prev: TimelineScene, next: TimelineScene) => {
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

const rotateBagToValidStart = (params: {
  bag: TransitionType[];
  lastUsed: TransitionType | null;
  avoidFade: boolean;
}) => {
  if (params.bag.length <= 1) return params.bag;

  for (let offset = 0; offset < params.bag.length; offset += 1) {
    const candidate = params.bag[offset];
    if (params.avoidFade && candidate === 'fade') continue;
    if (params.lastUsed && candidate === params.lastUsed) continue;
    if (offset === 0) return params.bag;
    return [...params.bag.slice(offset), ...params.bag.slice(0, offset)];
  }

  return params.bag;
};

// Transition plan per cut index (i = cut from scenes[i-1] -> scenes[i]).
// Rules:
// - Every eligible cut pulls from the same deterministic auto pool.
// - Auto transitions don't repeat until the full pool has been exhausted once.
// - The first auto-picked cut must not be `fade`.
export const buildCutTransitions = (scenes: TimelineScene[]): TransitionType[] => {
  const transitions: TransitionType[] = new Array(scenes.length).fill('none');
  if (scenes.length < 2) return transitions;

  const eligibleCuts: number[] = [];
  for (let i = 1; i < scenes.length; i += 1) {
    if (isMediaToMediaCut(scenes[i - 1], scenes[i])) eligibleCuts.push(i);
  }
  if (eligibleCuts.length === 0) return transitions;

  // Deterministic shuffle seed for this timeline.
  const seed =
    (scenes.length * 1337) ^ getCutSeed(scenes[0], scenes[scenes.length - 1]);
  const rand = mulberry32(seed);

  let bag = rotateBagToValidStart({
    bag: shuffleInPlace([...AUTO_CUT_TRANSITIONS], rand),
    lastUsed: null,
    avoidFade: true,
  });
  let bagIdx = 0;
  let lastUsed: TransitionType | null = null;
  let isFirstAutoPick = true;

  for (const cutIndex of eligibleCuts) {
    if (bagIdx >= bag.length) {
      bag = rotateBagToValidStart({
        bag: shuffleInPlace([...AUTO_CUT_TRANSITIONS], rand),
        lastUsed,
        avoidFade: isFirstAutoPick,
      });
      bagIdx = 0;
    }

    const t = bag[bagIdx];
    bagIdx += 1;
    transitions[cutIndex] = t;
    lastUsed = t;
    isFirstAutoPick = false;
  }

  return transitions;
};

export const pickWhipDirection = (prev: TimelineScene, next: TimelineScene) => {
  // +1 = move right, -1 = move left
  const r = mulberry32(getCutSeed(prev, next) ^ 0x9e3779b9)();
  return r < 0.5 ? 1 : -1;
};

export const getChromaParams = (seed: number) => {
  const rand = mulberry32(seed ^ 0x7f4a7c15);
  const dirX = rand() < 0.5 ? -1 : 1;
  const dirY = rand() < 0.5 ? -1 : 1;
  const strength = 0.85 + rand() * 0.5; // 0.85..1.35
  const originX = 20 + rand() * 60; // 20%..80%
  const originY = 20 + rand() * 50; // 20%..70%
  return { dirX, dirY, strength, originX, originY };
};
