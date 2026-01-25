import type { TimelineScene } from '../types';
import { mulberry32 } from './random';

export type TransitionType =
  | 'none'
  | 'glitch'
  | 'whip'
  | 'flash'
  | 'fade'
  | 'chromaLeak';

export const isImageToImageCut = (prev?: TimelineScene, next?: TimelineScene) => {
  return (
    !!prev?.imageSrc &&
    !prev?.videoSrc &&
    !!next?.imageSrc &&
    !next?.videoSrc
  );
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

// Transition plan per cut index (i = cut from scenes[i-1] -> scenes[i]).
// Rules:
// - Glitch happens ONLY on first and last eligible image->image cut.
// - Other transitions don't repeat until all have been used once.
export const buildCutTransitions = (scenes: TimelineScene[]): TransitionType[] => {
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
  const seed =
    (scenes.length * 1337) ^ getCutSeed(scenes[0], scenes[scenes.length - 1]);
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
