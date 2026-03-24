jest.mock('./assemblyai-alignment', () => ({
  alignWithAssemblyAi: jest.fn(),
  isAssemblyAiEnabled: jest.fn(),
}));

jest.mock('./replicate-whisperx-alignment', () => ({
  alignWithReplicateWhisperX: jest.fn(),
  isReplicateWhisperXEnabled: jest.fn(),
}));

import {
  alignAudioToSentences,
  alignByWordCount,
} from './audio-alignment';
import {
  alignWithAssemblyAi,
  isAssemblyAiEnabled,
} from './assemblyai-alignment';
import {
  alignWithReplicateWhisperX,
  isReplicateWhisperXEnabled,
} from './replicate-whisperx-alignment';

const mockedAlignWithAssemblyAi = jest.mocked(alignWithAssemblyAi);
const mockedIsAssemblyAiEnabled = jest.mocked(isAssemblyAiEnabled);
const mockedAlignWithReplicateWhisperX = jest.mocked(alignWithReplicateWhisperX);
const mockedIsReplicateWhisperXEnabled = jest.mocked(
  isReplicateWhisperXEnabled,
);

describe('alignByWordCount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedIsReplicateWhisperXEnabled.mockReturnValue(false);
    mockedIsAssemblyAiEnabled.mockReturnValue(false);
  });

  it('creates synthetic word timings for each sentence', () => {
    const timings = alignByWordCount(
      [{ text: 'Hello world again' }, { text: 'Second sentence here' }],
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

  it('uses Replicate WhisperX before AssemblyAI when it returns word timings', async () => {
    mockedIsReplicateWhisperXEnabled.mockReturnValue(true);
    mockedIsAssemblyAiEnabled.mockReturnValue(true);
    mockedAlignWithReplicateWhisperX.mockResolvedValue([
      { text: 'Hello', startSeconds: 0, endSeconds: 0.4 },
      { text: 'world', startSeconds: 0.4, endSeconds: 0.9 },
    ]);

    const timings = await alignAudioToSentences({
      openai: null,
      audioPath: 'unused.mp3',
      sentences: [{ text: 'Hello world' }],
      audioDurationSeconds: 1,
      withTimeout: async (promise) => promise,
      disableRenderer: true,
    });

    expect(mockedAlignWithReplicateWhisperX).toHaveBeenCalledTimes(1);
    expect(mockedAlignWithAssemblyAi).not.toHaveBeenCalled();
    expect(timings[0].words?.map((word) => word.text)).toEqual([
      'Hello',
      'world',
    ]);
  });

  it('falls back from Replicate WhisperX to AssemblyAI when WhisperX fails', async () => {
    mockedIsReplicateWhisperXEnabled.mockReturnValue(true);
    mockedIsAssemblyAiEnabled.mockReturnValue(true);
    mockedAlignWithReplicateWhisperX.mockRejectedValue(
      new Error('WhisperX timeout'),
    );
    mockedAlignWithAssemblyAi.mockResolvedValue([
      { text: 'Fallback', startSeconds: 0, endSeconds: 0.45 },
      { text: 'path', startSeconds: 0.45, endSeconds: 1 },
    ]);

    const timings = await alignAudioToSentences({
      openai: null,
      audioPath: 'unused.mp3',
      sentences: [{ text: 'Fallback path' }],
      audioDurationSeconds: 1,
      withTimeout: async (promise) => promise,
      disableRenderer: true,
    });

    expect(mockedAlignWithReplicateWhisperX).toHaveBeenCalledTimes(1);
    expect(mockedAlignWithAssemblyAi).toHaveBeenCalledTimes(1);
    expect(timings[0].words?.map((word) => word.text)).toEqual([
      'Fallback',
      'path',
    ]);
  });

  it('falls back to OpenAI when Replicate WhisperX and AssemblyAI fail', async () => {
    mockedIsReplicateWhisperXEnabled.mockReturnValue(true);
    mockedIsAssemblyAiEnabled.mockReturnValue(true);
    mockedAlignWithReplicateWhisperX.mockRejectedValue(
      new Error('WhisperX timeout'),
    );
    mockedAlignWithAssemblyAi.mockRejectedValue(new Error('Assembly down'));

    const createTranscription = jest.fn().mockResolvedValue({
      segments: [
        {
          start: 0,
          end: 1,
          text: 'OpenAI transcript',
        },
      ],
    });

    const timings = await alignAudioToSentences({
      openai: {
        audio: {
          transcriptions: {
            create: createTranscription,
          },
        },
      } as any,
      audioPath: __filename,
      sentences: [{ text: 'OpenAI transcript' }],
      audioDurationSeconds: 1,
      withTimeout: async (promise) => promise,
      disableRenderer: true,
    });

    expect(mockedAlignWithReplicateWhisperX).toHaveBeenCalledTimes(1);
    expect(mockedAlignWithAssemblyAi).toHaveBeenCalledTimes(1);
    expect(createTranscription).toHaveBeenCalledTimes(1);
    expect(timings[0].text).toBe('OpenAI transcript');
  });

  it('keeps later matched sentences aligned when one middle sentence does not match', async () => {
    mockedIsReplicateWhisperXEnabled.mockReturnValue(true);
    mockedIsAssemblyAiEnabled.mockReturnValue(false);
    mockedAlignWithReplicateWhisperX.mockResolvedValue([
      { text: 'Alpha', startSeconds: 0, endSeconds: 0.3 },
      { text: 'beta', startSeconds: 0.3, endSeconds: 0.7 },
      { text: 'Gamma', startSeconds: 1.5, endSeconds: 1.8 },
      { text: 'delta', startSeconds: 1.8, endSeconds: 2.2 },
    ]);

    const timings = await alignAudioToSentences({
      openai: null,
      audioPath: 'unused.mp3',
      sentences: [
        { text: 'Alpha beta' },
        { text: 'This sentence is missing' },
        { text: 'Gamma delta' },
      ],
      audioDurationSeconds: 3,
      withTimeout: async (promise) => promise,
      disableRenderer: true,
    });

    expect(timings).toHaveLength(3);
    expect(timings[0].words?.map((word) => word.text)).toEqual(['Alpha', 'beta']);
    expect(timings[1].words?.length).toBeGreaterThan(0);
    expect(timings[2].words?.map((word) => word.text)).toEqual(['Gamma', 'delta']);
    expect(timings[2].startSeconds).toBeCloseTo(1.5, 5);
    expect(timings[2].words?.[0].startSeconds).toBeCloseTo(1.5, 5);
  });
});
