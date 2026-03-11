import { getActiveSubtitleText } from './ProgressiveSubtitles';

describe('getActiveSubtitleText', () => {
  it('returns only the word currently being spoken', () => {
    const words = [
      { text: 'Hello', startFrame: 0, endFrame: 14 },
      { text: 'world', startFrame: 14, endFrame: 30 },
    ];

    expect(getActiveSubtitleText(words, 0)).toBe('Hello');
    expect(getActiveSubtitleText(words, 13)).toBe('Hello');
    expect(getActiveSubtitleText(words, 14)).toBe('world');
    expect(getActiveSubtitleText(words, 29)).toBe('world');
    expect(getActiveSubtitleText(words, 30)).toBe('');
  });

  it('prefers the most recent matching word when frame ranges overlap', () => {
    const words = [
      { text: 'Hello', startFrame: 0, endFrame: 14 },
      { text: 'world', startFrame: 13, endFrame: 30 },
    ];

    expect(getActiveSubtitleText(words, 13)).toBe('world');
  });
});