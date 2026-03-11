import { alignByWordCount } from './audio-alignment';

describe('alignByWordCount', () => {
  it('creates synthetic word timings for each sentence', () => {
    const timings = alignByWordCount(
      [
        { text: 'Hello world again' },
        { text: 'Second sentence here' },
      ],
      6,
    );

    expect(timings).toHaveLength(2);
    expect(timings[0].words).toHaveLength(3);
    expect(timings[1].words).toHaveLength(3);
    expect(timings[0].words?.[0].text).toBe('Hello');
    expect(timings[0].words?.[2].endSeconds).toBeLessThanOrEqual(
      timings[0].endSeconds,
    );
    expect(timings[1].startSeconds).toBeGreaterThanOrEqual(
      timings[0].endSeconds,
    );
  });

  it('keeps word timings monotonic within a sentence', () => {
    const [timing] = alignByWordCount([{ text: 'One two three four' }], 4);
    const words = timing.words ?? [];

    expect(words).toHaveLength(4);
    for (let index = 1; index < words.length; index += 1) {
      expect(words[index].startSeconds).toBeGreaterThanOrEqual(
        words[index - 1].endSeconds,
      );
    }
  });
});