import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type OpenAI from 'openai';
import type {
  SentenceInput,
  SentenceTiming,
  WordTiming,
} from '../render-videos.types';
import {
  alignWithAssemblyAi,
  isAssemblyAiEnabled,
} from './assemblyai-alignment';
import {
  alignWithReplicateWhisperX,
  isReplicateWhisperXEnabled,
} from './replicate-whisperx-alignment';

const readHeaderBytes = (filePath: string, length: number): Buffer => {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(Math.max(0, length));
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    return bytesRead === buf.length ? buf : buf.subarray(0, bytesRead);
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore
    }
  }
};

const looksLikeMp3Header = (buffer: Buffer): boolean => {
  if (!buffer || buffer.length < 4) return false;
  // MP3 can start with an ID3 tag.
  if (buffer.toString('ascii', 0, 3) === 'ID3') return true;

  // Otherwise we expect a valid MPEG audio frame header.
  if (!(buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return false;

  // Avoid false positives for AAC ADTS (also starts with 0xFF and 0xF1/0xF9).
  if (looksLikeAacAdtsHeader(buffer)) return false;

  // MPEG header validity checks:
  // - versionId cannot be 01 (reserved)
  // - layer cannot be 00 (reserved)
  const versionId = (buffer[1] >> 3) & 0x3;
  const layer = (buffer[1] >> 1) & 0x3;
  if (versionId === 0x1) return false;
  if (layer === 0x0) return false;

  return true;
};

const looksLikeWavHeader = (buffer: Buffer): boolean => {
  if (!buffer || buffer.length < 12) return false;
  const riff = buffer.toString('ascii', 0, 4);
  if (
    riff !== 'RIFF' &&
    riff !== 'RF64' &&
    riff !== 'BW64' &&
    riff !== 'RIFX'
  ) {
    return false;
  }
  return buffer.toString('ascii', 8, 12) === 'WAVE';
};

const looksLikeAacAdtsHeader = (buffer: Buffer): boolean => {
  // ADTS sync word is 12 bits set: 0xFFF.
  // This commonly manifests as 0xFF 0xF1 or 0xFF 0xF9.
  if (!buffer || buffer.length < 2) return false;
  if (buffer[0] !== 0xff) return false;
  // Upper 4 bits of byte1 must be 0xF.
  if ((buffer[1] & 0xf0) !== 0xf0) return false;
  // Layer bits in ADTS are always 00 (bits 2-1).
  if ((buffer[1] & 0x06) !== 0x00) return false;
  return true;
};

const looksLikeMp4Container = (buffer: Buffer): boolean => {
  // ISO BMFF (mp4/m4a) often has `ftyp` at offset 4.
  if (!buffer || buffer.length < 12) return false;
  return buffer.toString('ascii', 4, 8) === 'ftyp';
};

const looksLikeOgg = (buffer: Buffer): boolean => {
  if (!buffer || buffer.length < 4) return false;
  return buffer.toString('ascii', 0, 4) === 'OggS';
};

const looksLikeWebmOrMatroska = (buffer: Buffer): boolean => {
  // EBML header for Matroska/WebM: 1A 45 DF A3
  if (!buffer || buffer.length < 4) return false;
  return (
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  );
};

const copyToTempWithExtension = (inputPath: string, ext: string): string => {
  const safeExt = ext.startsWith('.') ? ext : `.${ext}`;
  const outPath = path.join(
    os.tmpdir(),
    `transcribe-${randomUUID()}${safeExt}`,
  );
  fs.copyFileSync(inputPath, outPath);
  return outPath;
};

const makeOpenAiUploadable = async (filePath: string): Promise<any> => {
  // Ensure we pass an Uploadable with a filename.
  // OpenAI can be picky if the multipart part lacks a name.
  const openaiPkg: any = await import('openai');
  const toFile: any = openaiPkg?.toFile;
  if (typeof toFile === 'function') {
    return await toFile(fs.createReadStream(filePath), path.basename(filePath));
  }

  // Fallback: most SDK versions accept ReadStream, but this may be less reliable.
  return fs.createReadStream(filePath);
};

type AudioKind =
  | 'mp3'
  | 'wav'
  | 'mp4'
  | 'webm'
  | 'ogg'
  | 'aac-adts'
  | 'unknown';

const detectAudioKind = (buffer: Buffer): AudioKind => {
  if (looksLikeWavHeader(buffer)) return 'wav';
  if (looksLikeMp4Container(buffer)) return 'mp4';
  if (looksLikeWebmOrMatroska(buffer)) return 'webm';
  if (looksLikeOgg(buffer)) return 'ogg';
  if (looksLikeAacAdtsHeader(buffer)) return 'aac-adts';
  if (looksLikeMp3Header(buffer)) return 'mp3';
  return 'unknown';
};

const transcodeToWavForTranscription = async (inputPath: string) => {
  const renderer: any = await import('@remotion/renderer');
  const outPath = path.join(
    os.tmpdir(),
    `transcribe-${randomUUID()}-transcoded.wav`,
  );

  // ffmpeg invocation:
  // - single channel and 16kHz is a safe speech-friendly choice
  // - output PCM wav
  const task = renderer?.RenderInternals?.callFf?.({
    bin: 'ffmpeg',
    indent: false,
    logLevel: 'warn',
    binariesDirectory: null,
    cancelSignal: undefined,
    args: [
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-f',
      'wav',
      outPath,
    ],
  });

  if (!task || typeof task.then !== 'function') {
    throw new Error('Remotion ffmpeg helper not available');
  }

  await task;

  return outPath;
};

const ensureOpenAiTranscriptionCompatibleAudio = async (params: {
  audioPath: string;
  disableRenderer?: boolean;
}): Promise<{ audioPath: string; cleanup: string[]; kind: AudioKind }> => {
  const cleanup: string[] = [];
  let audioPath = params.audioPath;

  const header = readHeaderBytes(audioPath, 64);
  const kind = detectAudioKind(header);
  const ext = path.extname(audioPath).toLowerCase();

  const desiredExt = (() => {
    switch (kind) {
      case 'mp3':
        return '.mp3';
      case 'wav':
        return '.wav';
      case 'mp4':
        // Could be .mp4 or .m4a; use .m4a to hint audio-only.
        return '.m4a';
      case 'webm':
        return '.webm';
      case 'ogg':
        return '.ogg';
      case 'aac-adts':
        return '.aac';
      default:
        return '';
    }
  })();

  console.log('[RenderVideosService] Audio container sniff', {
    ext,
    kind,
    desiredExt,
  });

  // If we can identify a supported container, we can sometimes fix things by
  // ensuring the file extension matches what the server expects.
  const isSupportedByOpenAi =
    kind === 'mp3' || kind === 'wav' || kind === 'mp4' || kind === 'webm';

  if (isSupportedByOpenAi && desiredExt && ext !== desiredExt) {
    const copied = copyToTempWithExtension(audioPath, desiredExt);
    cleanup.push(copied);
    audioPath = copied;
    console.log(
      '[RenderVideosService] Copied audio to correct extension for transcription (no transcode)',
      { audioPath },
    );

    return { audioPath, cleanup, kind };
  }

  // If the container is not supported (or unknown), attempt a WAV transcode
  // using Remotion's bundled ffmpeg (when allowed).
  if (!isSupportedByOpenAi) {
    if (params.disableRenderer) {
      console.warn(
        '[RenderVideosService] Audio container not OpenAI-supported and renderer disabled; cannot transcode',
        { kind },
      );
      return { audioPath, cleanup, kind };
    }

    try {
      const wavPath = await transcodeToWavForTranscription(audioPath);
      cleanup.push(wavPath);
      audioPath = wavPath;
      console.log(
        '[RenderVideosService] Transcoded audio to WAV for transcription',
        { audioPath },
      );
    } catch (e: any) {
      console.warn(
        '[RenderVideosService] Failed to transcode audio to WAV for transcription; using original',
        { kind, message: e?.message },
      );
    }
  }

  return { audioPath, cleanup, kind };
};

export type WithTimeout = <T>(
  promise: Promise<T>,
  ms: number,
  label: string,
) => Promise<T>;

const getReplicateWhisperXTimeoutMs = (audioDurationSeconds: number) => {
  const configured = Number(process.env.REPLICATE_WHISPERX_TIMEOUT_MS ?? '');
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(60_000, Math.floor(configured));
  }

  const safeAudioDurationSeconds = Number.isFinite(audioDurationSeconds)
    ? Math.max(0, audioDurationSeconds)
    : 0;
  const dynamicTimeoutMs =
    Math.ceil(safeAudioDurationSeconds * 12_000) + 180_000;

  return Math.min(1_800_000, Math.max(420_000, dynamicTimeoutMs));
};

const normalizeWord = (raw: string) =>
  raw
    .toString()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

type IndexedWordTiming = WordTiming & {
  token: string;
};

const splitSubtitleWords = (text: string) =>
  String(text ?? '')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);

const buildSyntheticWordTimings = (
  text: string,
  startSeconds: number,
  endSeconds: number,
): WordTiming[] => {
  const words = splitSubtitleWords(text);
  if (!words.length) return [];

  const safeStart = Number.isFinite(startSeconds) ? startSeconds : 0;
  const safeEnd =
    Number.isFinite(endSeconds) && endSeconds > safeStart
      ? endSeconds
      : safeStart + 0.1;
  const span = Math.max(0.1, safeEnd - safeStart);

  return words.map((word, index) => {
    const wordStart = safeStart + (span * index) / words.length;
    const wordEnd = safeStart + (span * (index + 1)) / words.length;
    return {
      text: word,
      startSeconds: wordStart,
      endSeconds: Math.max(wordStart + 0.01, wordEnd),
    };
  });
};

const withSyntheticWords = (timings: SentenceTiming[]) =>
  timings.map((timing) => ({
    ...timing,
    words:
      Array.isArray(timing.words) && timing.words.length > 0
        ? timing.words
        : buildSyntheticWordTimings(
            timing.text,
            timing.startSeconds,
            timing.endSeconds,
          ),
  }));

const toIndexedWordsTimeline = (words: WordTiming[]) =>
  words
    .map((word) => {
      const token = normalizeWord(word.text);
      if (!token) return null;
      if (
        !Number.isFinite(word.startSeconds) ||
        !Number.isFinite(word.endSeconds) ||
        word.endSeconds <= word.startSeconds
      ) {
        return null;
      }

      return {
        ...word,
        token,
      } satisfies IndexedWordTiming;
    })
    .filter((word): word is IndexedWordTiming => word !== null);

const buildSentenceTimingsFromWordTimeline = (params: {
  sentences: SentenceInput[];
  wordsTimeline: IndexedWordTiming[];
  audioDurationSeconds: number;
}): SentenceTiming[] => {
  const timings: SentenceTiming[] = [];
  let wordIndex = 0;

  const lastWordEnd =
    (params.wordsTimeline[params.wordsTimeline.length - 1]?.endSeconds ??
      params.audioDurationSeconds) ||
    1;
  const totalDuration = Math.max(1, lastWordEnd);
  const cleaned = params.sentences.map((sentence) =>
    String(sentence.text ?? '').trim(),
  );
  const transcriptTokens = params.wordsTimeline.map((word) => word.token);

  const findBestMatch = (
    startFrom: number,
    sentenceTokens: string[],
  ): { start: number; end: number } | null => {
    if (!sentenceTokens.length) return null;

    const maxStart = transcriptTokens.length - sentenceTokens.length;
    if (maxStart < startFrom) return null;

    let bestScore = 0;
    let best: { start: number; end: number } | null = null;

    for (let index = startFrom; index <= maxStart; index += 1) {
      let matches = 0;
      for (let offset = 0; offset < sentenceTokens.length; offset += 1) {
        if (transcriptTokens[index + offset] === sentenceTokens[offset]) {
          matches += 1;
        }
      }

      const score = matches / sentenceTokens.length;
      if (score > bestScore && score >= 0.5) {
        bestScore = score;
        best = { start: index, end: index + sentenceTokens.length - 1 };
      }
    }

    return best;
  };

  const sentenceMatches = cleaned.map((text, index) => {
    const rawWords = splitSubtitleWords(text);
    const normalizedWords = rawWords
      .map((rawWord) => ({ text: rawWord, token: normalizeWord(rawWord) }))
      .filter((word) => !!word.token);
    const sentenceTokens = normalizedWords.map((word) => word.token);

    if (!text) {
      return {
        index,
        text,
        normalizedWords,
        match: null as { start: number; end: number } | null,
        kind: 'empty' as const,
      };
    }

    if (!sentenceTokens.length) {
      return {
        index,
        text,
        normalizedWords,
        match: null as { start: number; end: number } | null,
        kind: 'synthetic' as const,
      };
    }

    const match = findBestMatch(wordIndex, sentenceTokens);
    if (match) {
      wordIndex = match.end + 1;
    }

    return {
      index,
      text,
      normalizedWords,
      match,
      kind: match ? ('matched' as const) : ('synthetic' as const),
    };
  });

  const pushSyntheticBlock = (
    startIndex: number,
    endIndexExclusive: number,
  ) => {
    if (startIndex >= endIndexExclusive) return;

    const prevEnd = timings.length ? timings[timings.length - 1].endSeconds : 0;
    const nextMatched = sentenceMatches
      .slice(endIndexExclusive)
      .find((entry) => entry.match);

    const nextMatchedStart = nextMatched?.match
      ? params.wordsTimeline[nextMatched.match.start]?.startSeconds
      : null;

    const blockSpan =
      nextMatchedStart !== null && Number.isFinite(nextMatchedStart)
        ? Math.max(0.1, nextMatchedStart - prevEnd)
        : Math.max(0.1, totalDuration - prevEnd);

    const synthetic = alignByWordCount(
      params.sentences.slice(startIndex, endIndexExclusive),
      blockSpan,
    );

    for (const timing of synthetic) {
      timings.push({
        index: startIndex + timing.index,
        text: timing.text,
        startSeconds: prevEnd + timing.startSeconds,
        endSeconds: prevEnd + timing.endSeconds,
        words: (timing.words ?? []).map((word) => ({
          ...word,
          startSeconds: prevEnd + word.startSeconds,
          endSeconds: prevEnd + word.endSeconds,
        })),
      });
    }
  };

  let syntheticBlockStart: number | null = null;

  for (let index = 0; index < sentenceMatches.length; index += 1) {
    const entry = sentenceMatches[index];

    if (!entry.match) {
      if (syntheticBlockStart === null) {
        syntheticBlockStart = index;
      }
      continue;
    }

    if (syntheticBlockStart !== null) {
      pushSyntheticBlock(syntheticBlockStart, index);
      syntheticBlockStart = null;
    }

    const firstWord = params.wordsTimeline[entry.match.start];
    const lastWord = params.wordsTimeline[entry.match.end];
    let startSeconds = firstWord.startSeconds;
    let endSeconds = lastWord.endSeconds;

    if (!Number.isFinite(startSeconds)) startSeconds = 0;
    if (!Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
      endSeconds = startSeconds + 0.1;
    }

    startSeconds = Math.max(0, Math.min(startSeconds, totalDuration));
    endSeconds = Math.max(
      startSeconds + 0.05,
      Math.min(endSeconds, totalDuration),
    );

    const words = entry.normalizedWords.map((word, offset) => {
      const matchedWord = params.wordsTimeline[entry.match!.start + offset];
      return {
        text: word.text,
        startSeconds: matchedWord.startSeconds,
        endSeconds: Math.max(
          matchedWord.startSeconds + 0.01,
          matchedWord.endSeconds,
        ),
        ...(typeof matchedWord.confidence === 'number'
          ? { confidence: matchedWord.confidence }
          : {}),
      } satisfies WordTiming;
    });

    timings.push({
      index: entry.index,
      text: entry.text,
      startSeconds,
      endSeconds,
      words,
    });
  }

  if (syntheticBlockStart !== null) {
    pushSyntheticBlock(syntheticBlockStart, sentenceMatches.length);
  }

  if (timings.length) {
    const last = timings[timings.length - 1];
    if (last.endSeconds < totalDuration) {
      last.endSeconds = totalDuration;
    }
  }

  return withSyntheticWords(timings);
};

export const alignByWordCount = (
  sentences: SentenceInput[],
  audioDurationSeconds: number,
): SentenceTiming[] => {
  const T = Math.max(1, audioDurationSeconds || 1);
  const cleaned = sentences.map((s) => (s.text || '').trim());

  const rawWeights = cleaned.map((text) => {
    if (!text) return 1;
    const words = text.split(/\s+/).filter(Boolean);
    return Math.max(1, words.length);
  });

  const totalWeight = rawWeights.reduce((sum, w) => sum + w, 0) || 1;

  let accumulatedWeight = 0;
  const timings: SentenceTiming[] = rawWeights.map((weight, index) => {
    const startRatio = accumulatedWeight / totalWeight;
    accumulatedWeight += weight;
    let endRatio = accumulatedWeight / totalWeight;

    if (index === rawWeights.length - 1) {
      endRatio = 1;
    }

    const startSeconds = startRatio * T;
    const endSeconds = Math.max(startSeconds + 0.1, endRatio * T);

    return {
      index,
      text: cleaned[index],
      startSeconds,
      endSeconds,
      words: buildSyntheticWordTimings(
        cleaned[index],
        startSeconds,
        endSeconds,
      ),
    };
  });

  return withSyntheticWords(timings);
};

export const alignByVoiceActivity = async (
  audioPath: string,
  sentences: SentenceInput[],
  audioDurationSeconds: number,
): Promise<SentenceTiming[]> => {
  try {
    const { getSilentParts } = await import('@remotion/renderer');
    const result: any = await getSilentParts({
      src: audioPath,
      minDurationInSeconds: 0.2,
      noiseThresholdInDecibels: -35,
    });

    const audible = Array.isArray(result?.audibleParts)
      ? result.audibleParts
      : [];

    if (!audible.length) {
      return alignByWordCount(sentences, audioDurationSeconds);
    }

    const segments = audible
      .map((p: any) => ({
        start: Number(p.startInSeconds),
        end: Number(p.endInSeconds),
      }))
      .filter(
        (p) =>
          Number.isFinite(p.start) && Number.isFinite(p.end) && p.end > p.start,
      )
      .sort((a, b) => a.start - b.start);

    if (!segments.length) {
      return alignByWordCount(sentences, audioDurationSeconds);
    }

    const voicedDuration = segments.reduce(
      (sum, s) => sum + (s.end - s.start),
      0,
    );

    if (!Number.isFinite(voicedDuration) || voicedDuration <= 0) {
      return alignByWordCount(sentences, audioDurationSeconds);
    }

    const compressedTimings = alignByWordCount(sentences, voicedDuration);

    type SegmentMap = {
      realStart: number;
      realEnd: number;
      compressedStart: number;
      compressedEnd: number;
    };

    const segmentMaps: SegmentMap[] = [];
    let compressedCursor = 0;
    for (const seg of segments) {
      const length = seg.end - seg.start;
      const mapped: SegmentMap = {
        realStart: seg.start,
        realEnd: seg.end,
        compressedStart: compressedCursor,
        compressedEnd: compressedCursor + length,
      };
      segmentMaps.push(mapped);
      compressedCursor += length;
    }

    const mapTime = (tCompressed: number): number => {
      if (!Number.isFinite(tCompressed) || tCompressed <= 0) {
        return segments[0].start;
      }

      const lastSeg = segmentMaps[segmentMaps.length - 1];
      if (tCompressed >= lastSeg.compressedEnd) {
        return lastSeg.realEnd;
      }

      for (const seg of segmentMaps) {
        if (
          tCompressed >= seg.compressedStart &&
          tCompressed <= seg.compressedEnd
        ) {
          const within = tCompressed - seg.compressedStart;
          return seg.realStart + within;
        }
      }

      return lastSeg.realEnd;
    };

    const mappedTimings: SentenceTiming[] = compressedTimings.map((t) => {
      const realStart = mapTime(t.startSeconds);
      const realEnd = Math.max(realStart + 0.05, mapTime(t.endSeconds));

      return {
        index: t.index,
        text: t.text,
        startSeconds: realStart,
        endSeconds: realEnd,
        words: (t.words ?? []).map((word) => ({
          ...word,
          startSeconds: mapTime(word.startSeconds),
          endSeconds: Math.max(
            mapTime(word.startSeconds) + 0.01,
            mapTime(word.endSeconds),
          ),
        })),
      };
    });

    const realDuration =
      Number(result?.durationInSeconds) || audioDurationSeconds || 1;
    const T = Math.max(1, realDuration);

    for (const t of mappedTimings) {
      if (!Number.isFinite(t.startSeconds) || t.startSeconds < 0) {
        t.startSeconds = 0;
      }
      if (!Number.isFinite(t.endSeconds) || t.endSeconds <= t.startSeconds) {
        t.endSeconds = t.startSeconds + 0.1;
      }
      t.startSeconds = Math.max(0, Math.min(t.startSeconds, T));
      t.endSeconds = Math.max(t.startSeconds + 0.05, Math.min(t.endSeconds, T));
    }

    if (mappedTimings.length) {
      const last = mappedTimings[mappedTimings.length - 1];
      if (last.endSeconds < T) {
        last.endSeconds = T;
      }
    }

    return withSyntheticWords(mappedTimings);
  } catch {
    return alignByWordCount(sentences, audioDurationSeconds);
  }
};

export const alignAudioToSentences = async (params: {
  openai: OpenAI | null;
  audioPath: string;
  sentences: SentenceInput[];
  audioDurationSeconds: number;
  withTimeout: WithTimeout;
  disableRenderer?: boolean;
}): Promise<SentenceTiming[]> => {
  const tempFilesToCleanup: string[] = [];
  const fallback = () => {
    if (params.disableRenderer) {
      return Promise.resolve(
        alignByWordCount(params.sentences, params.audioDurationSeconds),
      );
    }

    return alignByVoiceActivity(
      params.audioPath,
      params.sentences,
      params.audioDurationSeconds,
    );
  };

  console.log('[RenderVideosService] alignAudioToSentences called', {
    audioPath: params.audioPath,
    audioDurationSeconds: params.audioDurationSeconds,
    sentenceCount: params.sentences.length,
    hasReplicateWhisperX: isReplicateWhisperXEnabled(),
    hasAssemblyAi: isAssemblyAiEnabled(),
    hasOpenAI: !!params.openai,
    disableRenderer: !!params.disableRenderer,
  });

  if (isReplicateWhisperXEnabled()) {
    try {
      const whisperXTimeoutMs = getReplicateWhisperXTimeoutMs(
        params.audioDurationSeconds,
      );
      const whisperXWords = await params.withTimeout(
        alignWithReplicateWhisperX(params.audioPath),
        whisperXTimeoutMs,
        'Replicate WhisperX transcription',
      );
      const indexedWhisperXWords = toIndexedWordsTimeline(whisperXWords);
      if (indexedWhisperXWords.length > 0) {
        console.log(
          '[RenderVideosService] Using Replicate WhisperX alignment',
          {
            alignedWords: indexedWhisperXWords.length,
            timeoutMs: whisperXTimeoutMs,
          },
        );

        return buildSentenceTimingsFromWordTimeline({
          sentences: params.sentences,
          wordsTimeline: indexedWhisperXWords,
          audioDurationSeconds: params.audioDurationSeconds,
        });
      }

      console.warn(
        '[RenderVideosService] Replicate WhisperX returned no usable words, falling back',
      );
    } catch (error: any) {
      console.warn(
        '[RenderVideosService] Replicate WhisperX alignment failed, falling back',
        {
          message: error?.message,
        },
      );
    }
  }

  if (isAssemblyAiEnabled()) {
    try {
      const assemblyWords = await params.withTimeout(
        alignWithAssemblyAi(params.audioPath),
        Number(process.env.ASSEMBLYAI_TIMEOUT_MS ?? '180000'),
        'AssemblyAI transcription',
      );

      const indexedAssemblyWords = toIndexedWordsTimeline(assemblyWords);
      if (indexedAssemblyWords.length > 0) {
        console.log('[RenderVideosService] Using AssemblyAI alignment', {
          alignedWords: indexedAssemblyWords.length,
        });

        return buildSentenceTimingsFromWordTimeline({
          sentences: params.sentences,
          wordsTimeline: indexedAssemblyWords,
          audioDurationSeconds: params.audioDurationSeconds,
        });
      }

      console.warn(
        '[RenderVideosService] AssemblyAI returned no usable words, falling back',
      );
    } catch (error: any) {
      console.warn(
        '[RenderVideosService] AssemblyAI alignment failed, falling back',
        {
          message: error?.message,
        },
      );
    }
  }

  if (!params.openai) {
    console.log(
      '[RenderVideosService] OpenAI client not configured, using fallback alignment',
    );
    return fallback();
  }

  if (!fs.existsSync(params.audioPath)) {
    console.warn('[RenderVideosService] Audio file not found for alignment', {
      audioPath: params.audioPath,
    });
    return fallback();
  }

  try {
    const stat = fs.statSync(params.audioPath);
    console.log('[RenderVideosService] Audio file stat for alignment', {
      audioPath: params.audioPath,
      sizeBytes: stat.size,
    });
    if (!stat.size) {
      console.warn('[RenderVideosService] Audio file is empty, using fallback');
      return fallback();
    }

    const model = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe';
    // Model compatibility: gpt-4o-transcribe currently supports only 'json' or 'text'.
    // Whisper supports 'verbose_json' which includes timestamps/segments.
    const responseFormat: 'json' | 'verbose_json' = model.startsWith('gpt-4o')
      ? 'json'
      : 'verbose_json';

    // Ensure OpenAI gets a well-formed, supported audio file.
    // Some providers may return AAC ADTS or other containers that are playable
    // but not accepted by OpenAI; in that case we attempt a WAV transcode.
    let transcriptionAudioPath = params.audioPath;
    try {
      const ensured = await ensureOpenAiTranscriptionCompatibleAudio({
        audioPath: transcriptionAudioPath,
        disableRenderer: params.disableRenderer,
      });
      transcriptionAudioPath = ensured.audioPath;
      tempFilesToCleanup.push(...ensured.cleanup);
    } catch (e: any) {
      console.warn(
        '[RenderVideosService] Failed to ensure transcription-compatible audio; using original',
        { message: e?.message },
      );
      transcriptionAudioPath = params.audioPath;
    }

    console.log(
      '[RenderVideosService] Calling OpenAI audio.transcriptions.create',
      {
        model,
        responseFormat,
      },
    );

    const createTranscription = async (audioPath: string) => {
      const file = await makeOpenAiUploadable(audioPath);
      return await params.openai!.audio.transcriptions.create({
        file,
        model,
        response_format: responseFormat as any,
      } as any);
    };

    let transcription: any;
    try {
      transcription = await params.withTimeout(
        createTranscription(transcriptionAudioPath),
        Number(process.env.OPENAI_TRANSCRIBE_TIMEOUT_MS ?? '120000'),
        'OpenAI transcription',
      );
    } catch (e: any) {
      const status = Number(e?.status ?? e?.response?.status ?? 0);
      const msg = String(e?.message ?? '');
      const looksLikeUnsupported =
        status === 400 &&
        /corrupt|unsupported|invalid|cannot decode|decode/iu.test(msg);

      console.warn('[RenderVideosService] Primary transcription failed', {
        status,
        message: msg,
      });

      // If OpenAI says the audio is corrupted/unsupported, retry once by transcoding to WAV.
      // This often fixes files that are mislabeled (e.g. AAC ADTS saved as .mp3).
      if (!params.disableRenderer && looksLikeUnsupported) {
        try {
          const wavPath = await transcodeToWavForTranscription(
            transcriptionAudioPath,
          );
          tempFilesToCleanup.push(wavPath);
          transcriptionAudioPath = wavPath;
          console.log(
            '[RenderVideosService] Retrying transcription with WAV-transcoded audio',
            { transcriptionAudioPath },
          );

          transcription = await params.withTimeout(
            createTranscription(transcriptionAudioPath),
            Number(process.env.OPENAI_TRANSCRIBE_TIMEOUT_MS ?? '120000'),
            'OpenAI transcription (retry wav)',
          );
        } catch (retryErr: any) {
          console.warn('[RenderVideosService] WAV retry transcription failed', {
            message: retryErr?.message,
          });
          throw e;
        }
      } else {
        throw e;
      }
    }

    let segments: any[] = Array.isArray(transcription?.segments)
      ? transcription.segments
      : [];

    console.log('[RenderVideosService] OpenAI transcription result', {
      hasSegments: Array.isArray(transcription?.segments),
      segmentCount: segments.length,
    });

    if (!segments.length) {
      const whisperModel = 'whisper-1';

      console.warn(
        '[RenderVideosService] Primary transcription model returned no segments; retrying with Whisper',
        { primaryModel: model, whisperModel },
      );

      const whisperTranscription: any = await params.withTimeout(
        (async () => {
          const file = await makeOpenAiUploadable(transcriptionAudioPath);
          return params.openai!.audio.transcriptions.create({
            file,
            model: whisperModel,
            response_format: 'verbose_json' as any,
          } as any);
        })(),
        Number(process.env.OPENAI_TRANSCRIBE_TIMEOUT_MS ?? '120000'),
        'OpenAI Whisper transcription',
      );

      segments = Array.isArray(whisperTranscription?.segments)
        ? whisperTranscription.segments
        : [];

      console.log('[RenderVideosService] Whisper transcription result', {
        hasSegments: Array.isArray(whisperTranscription?.segments),
        segmentCount: segments.length,
      });

      if (!segments.length) {
        console.warn(
          '[RenderVideosService] Whisper also returned no segments, using fallback alignment',
        );
        return fallback();
      }
    }

    const wordsTimeline: IndexedWordTiming[] = [];

    for (const seg of segments) {
      const segStartRaw = seg.start;
      const segEndRaw = seg.end;
      const segStart =
        typeof segStartRaw === 'number' ? segStartRaw : parseFloat(segStartRaw);
      const segEnd =
        typeof segEndRaw === 'number' ? segEndRaw : parseFloat(segEndRaw);

      if (!Number.isFinite(segStart) || !Number.isFinite(segEnd)) continue;
      if (segEnd <= segStart) continue;

      const rawText = seg.text ?? '';
      const text = rawText.toString().trim();
      if (!text) continue;

      const tokens = text.split(/\s+/u).filter(Boolean);
      const span = segEnd - segStart;
      const count = tokens.length || 1;

      for (let i = 0; i < count; i += 1) {
        const wStart = segStart + (span * i) / count;
        const wEnd = segStart + (span * (i + 1)) / count;
        const token = normalizeWord(tokens[i] ?? '');
        if (!token) continue;
        wordsTimeline.push({
          text: tokens[i] ?? '',
          token,
          startSeconds: wStart,
          endSeconds: wEnd,
        });
      }
    }

    if (!wordsTimeline.length) {
      console.warn(
        '[RenderVideosService] No wordsTimeline built from transcription, using fallback alignment',
      );
      return fallback();
    }

    const timings = buildSentenceTimingsFromWordTimeline({
      sentences: params.sentences,
      wordsTimeline,
      audioDurationSeconds: params.audioDurationSeconds,
    });

    console.log(
      '[RenderVideosService] OpenAI-based alignment produced timings',
      {
        timingCount: timings.length,
      },
    );

    return timings;
  } catch (err: any) {
    console.error(
      '[RenderVideosService] Error during OpenAI alignment, using fallback',
      {
        message: err?.message,
      },
    );
    return fallback();
  } finally {
    // Best-effort cleanup for any temp transcode files we created.
    // (No-op if we didn't create any.)
    for (const p of tempFilesToCleanup) {
      try {
        if (p && p !== params.audioPath && fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // ignore
      }
    }
  }
};
