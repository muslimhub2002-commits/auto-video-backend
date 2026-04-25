import type { TimelineScene } from '../../../remotion/src/types';
import {
  AUTO_CUT_TRANSITIONS,
  buildCutTransitions,
} from '../../../remotion/src/utils/transitions';

const makeImageScene = (index: number): TimelineScene => ({
  index,
  text: `Scene ${index + 1}`,
  imageSrc: `images/${index + 1}.jpg`,
  startFrame: index * 30,
  durationFrames: 30,
});

describe('buildCutTransitions', () => {
  it('uses the full auto pool exactly once before any repeat', () => {
    const scenes = Array.from({ length: AUTO_CUT_TRANSITIONS.length + 1 }, (_, index) =>
      makeImageScene(index),
    );

    const autoTransitions = buildCutTransitions(scenes).slice(1);
    const counts = new Map<string, number>();

    for (const transition of autoTransitions) {
      counts.set(transition, (counts.get(transition) ?? 0) + 1);
    }

    expect(autoTransitions).toHaveLength(AUTO_CUT_TRANSITIONS.length);
    expect(autoTransitions[0]).not.toBe('fade');
    expect(autoTransitions).not.toContain('none');

    for (const transition of AUTO_CUT_TRANSITIONS) {
      expect(counts.get(transition)).toBe(1);
    }
  });

  it('avoids an immediate repeat when the bag reshuffles', () => {
    const scenes = Array.from({ length: AUTO_CUT_TRANSITIONS.length + 2 }, (_, index) =>
      makeImageScene(index),
    );

    const autoTransitions = buildCutTransitions(scenes).slice(1);
    const firstCycle = autoTransitions.slice(0, AUTO_CUT_TRANSITIONS.length);
    const secondCycleFirstPick = autoTransitions[AUTO_CUT_TRANSITIONS.length];

    expect(new Set(firstCycle).size).toBe(AUTO_CUT_TRANSITIONS.length);
    expect(secondCycleFirstPick).not.toBe(firstCycle[firstCycle.length - 1]);
  });
});