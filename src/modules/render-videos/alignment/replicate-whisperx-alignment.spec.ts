import { parseReplicateWhisperXOutput } from './replicate-whisperx-alignment';

describe('parseReplicateWhisperXOutput', () => {
  it('parses the object output returned by the victor-upmeet model', () => {
    const words = parseReplicateWhisperXOutput({
      segments: [
        {
          start: 0,
          end: 1,
          text: 'Hello world',
          words: [
            { word: 'Hello', start: 0, end: 0.4, score: 0.91 },
            { word: 'world', start: 0.4, end: 0.9, score: 0.88 },
          ],
        },
      ],
    });

    expect(words).toEqual([
      {
        text: 'Hello',
        startSeconds: 0,
        endSeconds: 0.4,
        confidence: 0.91,
      },
      {
        text: 'world',
        startSeconds: 0.4,
        endSeconds: 0.9,
        confidence: 0.88,
      },
    ]);
  });

  it('still parses legacy stringified segment output', () => {
    const words = parseReplicateWhisperXOutput(
      JSON.stringify([
        {
          start: 0,
          end: 1,
          text: 'Hello world',
          words: [
            { word: 'Hello', start: 0, end: 0.4, score: 0.91 },
            { word: 'world', start: 0.4, end: 0.9, score: 0.88 },
          ],
        },
      ]),
    );

    expect(words).toEqual([
      {
        text: 'Hello',
        startSeconds: 0,
        endSeconds: 0.4,
        confidence: 0.91,
      },
      {
        text: 'world',
        startSeconds: 0.4,
        endSeconds: 0.9,
        confidence: 0.88,
      },
    ]);
  });

  it('supports alternate word_segments output and filters malformed words', () => {
    const words = parseReplicateWhisperXOutput({
      segments: [
        {
          word_segments: [
            { word: 'First', start: 0, end: 0.2, score: 0.7 },
            { word: '', start: 0.2, end: 0.3, score: 0.5 },
            { word: 'Second', start: 0.3, end: 0.6, score: '0.8' },
          ],
        },
      ],
    });

    expect(words).toEqual([
      {
        text: 'First',
        startSeconds: 0,
        endSeconds: 0.2,
        confidence: 0.7,
      },
      {
        text: 'Second',
        startSeconds: 0.3,
        endSeconds: 0.6,
        confidence: 0.8,
      },
    ]);
  });

  it('throws when Replicate WhisperX returns invalid JSON', () => {
    expect(() => parseReplicateWhisperXOutput('not-json')).toThrow(
      'Replicate WhisperX returned invalid JSON',
    );
  });
});
