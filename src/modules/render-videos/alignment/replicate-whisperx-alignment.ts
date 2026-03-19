import * as fs from 'fs';
import type { WordTiming } from '../render-videos.types';

const DEFAULT_WHISPERX_MODEL_IDENTIFIER =
  'victor-upmeet/whisperx:84d2ad2d6194fe98a17d2b60bef1c7f910c46b2f6fd38996ca457afd9c8abfcb';

type ReplicateModelIdentifier =
  | `${string}/${string}`
  | `${string}/${string}:${string}`;

type WhisperXWord = {
  word?: string;
  start?: number | string;
  end?: number | string;
  score?: number | string;
};

type WhisperXSegment = {
  start?: number | string;
  end?: number | string;
  text?: string;
  words?: WhisperXWord[];
  word_segments?: WhisperXWord[];
};

const getReplicateToken = () => String(process.env.REPLICATE_TOKEN ?? '').trim();

export const isReplicateWhisperXEnabled = () => !!getReplicateToken();

const toFiniteNumber = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const getModelIdentifier = (): ReplicateModelIdentifier => {
  const configured = String(
    process.env.REPLICATE_WHISPERX_MODEL ??
      process.env.REPLICATE_WHISPERX_MODEL_VERSION ??
      '',
  ).trim();

  if (!configured) {
    return DEFAULT_WHISPERX_MODEL_IDENTIFIER as ReplicateModelIdentifier;
  }

  if (configured.includes('/')) {
    return configured as ReplicateModelIdentifier;
  }

  return `victor-upmeet/whisperx:${configured}`;
};

const getBatchSize = () => {
  const configured = Number(process.env.REPLICATE_WHISPERX_BATCH_SIZE ?? '16');
  if (!Number.isFinite(configured)) return 16;
  return Math.max(1, Math.floor(configured));
};

const getPollIntervalMs = () => {
  const configured = Number(
    process.env.REPLICATE_WHISPERX_POLL_INTERVAL_MS ?? '1500',
  );
  if (!Number.isFinite(configured)) return 1500;
  return Math.max(500, Math.floor(configured));
};

const toReplicateErrorMessage = (error: unknown) => {
  const message =
    error instanceof Error ? error.message : String(error ?? 'Unknown error');

  if (/status 402|insufficient credit|payment required/iu.test(message)) {
    return 'Replicate WhisperX billing error: insufficient Replicate credit for this model run';
  }

  return message;
};

const toSegments = (output: unknown): WhisperXSegment[] => {
  let parsed = output;

  if (typeof output === 'string') {
    try {
      parsed = JSON.parse(output);
    } catch (error: any) {
      throw new Error(
        `Replicate WhisperX returned invalid JSON: ${error?.message ?? 'unknown parse failure'}`,
      );
    }
  }

  if (Array.isArray(parsed)) {
    return parsed as WhisperXSegment[];
  }

  if (parsed && typeof parsed === 'object') {
    const segments = (parsed as { segments?: unknown }).segments;
    if (Array.isArray(segments)) {
      return segments as WhisperXSegment[];
    }
  }

  throw new Error('Replicate WhisperX output did not contain transcript segments');
};

export const parseReplicateWhisperXOutput = (output: unknown): WordTiming[] => {
  const segments = toSegments(output);

  return segments
    .flatMap((segment) => {
      const words = Array.isArray(segment.words)
        ? segment.words
        : Array.isArray(segment.word_segments)
          ? segment.word_segments
          : [];
      return words.map((word) => {
        const text = String(word.word ?? '').trim();
        const startSeconds = toFiniteNumber(word.start);
        const endSeconds = toFiniteNumber(word.end);
        const confidence = toFiniteNumber(word.score);

        if (
          !text ||
          startSeconds === null ||
          endSeconds === null ||
          endSeconds <= startSeconds
        ) {
          return null;
        }

        return {
          text,
          startSeconds,
          endSeconds,
          ...(confidence !== null ? { confidence } : {}),
        } satisfies WordTiming;
      });
    })
    .filter((word): word is WordTiming => word !== null)
    .sort((left, right) => left.startSeconds - right.startSeconds);
};

export const alignWithReplicateWhisperX = async (
  audioPath: string,
): Promise<WordTiming[]> => {
  if (!isReplicateWhisperXEnabled()) {
    throw new Error('REPLICATE_TOKEN is not configured');
  }

  const audioBuffer = await fs.promises.readFile(audioPath);
  if (!audioBuffer.length) {
    throw new Error('Replicate WhisperX audio input is empty');
  }

  const replicateModule = await import('replicate');
  const Replicate = (replicateModule as any).default ?? replicateModule;
  const replicate = new Replicate({
    auth: getReplicateToken(),
    useFileOutput: false,
    fileEncodingStrategy: 'upload',
  });

  let output: unknown;
  try {
    output = await replicate.run(
      getModelIdentifier(),
      {
        input: {
          audio_file: audioBuffer,
          debug: false,
          batch_size: getBatchSize(),
          temperature: 0,
          align_output: true,
        },
        wait: {
          mode: 'poll',
          interval: getPollIntervalMs(),
        },
      },
    );
  } catch (error: unknown) {
    throw new Error(toReplicateErrorMessage(error));
  }

  return parseReplicateWhisperXOutput(output);
};