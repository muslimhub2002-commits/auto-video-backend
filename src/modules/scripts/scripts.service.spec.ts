import { ScriptsService } from './scripts.service';

describe('ScriptsService', () => {
  it('normalizes text shadow settings for draft sentence animation saves', () => {
    const service = new ScriptsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const normalized = (
      service as unknown as {
        normalizeTextAnimationSettingsObject: (
          value: unknown,
        ) => Record<string, unknown> | null;
      }
    ).normalizeTextAnimationSettingsObject({
      presetKey: 'slideCutFast',
      shadowOpacity: 1.7,
      shadowBlurPx: -4,
    });

    expect(normalized).toMatchObject({
      presetKey: 'slideCutFast',
      shadowOpacity: 1,
      shadowBlurPx: 0,
    });
  });
});