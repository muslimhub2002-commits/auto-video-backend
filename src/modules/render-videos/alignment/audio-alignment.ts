import * as fs from 'fs';
import type OpenAI from 'openai';
import type { SentenceInput, SentenceTiming } from '../render-videos.types';

export type WithTimeout = <T>(promise: Promise<T>, ms: number, label: string) => Promise<T>;

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
    };
  });

  return timings;
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

    const audible = Array.isArray(result?.audibleParts) ? result.audibleParts : [];

    if (!audible.length) {
      return alignByWordCount(sentences, audioDurationSeconds);
    }

    const segments = audible
      .map((p: any) => ({
        start: Number(p.startInSeconds),
        end: Number(p.endInSeconds),
      }))
      .filter((p) => Number.isFinite(p.start) && Number.isFinite(p.end) && p.end > p.start)
      .sort((a, b) => a.start - b.start);

    if (!segments.length) {
      return alignByWordCount(sentences, audioDurationSeconds);
    }

    const voicedDuration = segments.reduce((sum, s) => sum + (s.end - s.start), 0);

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
        if (tCompressed >= seg.compressedStart && tCompressed <= seg.compressedEnd) {
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
      };
    });

    const realDuration = Number(result?.durationInSeconds) || audioDurationSeconds || 1;
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

    return mappedTimings;
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
  const fallback = () => {
    if (params.disableRenderer) {
      return Promise.resolve(alignByWordCount(params.sentences, params.audioDurationSeconds));
    }

    return alignByVoiceActivity(params.audioPath, params.sentences, params.audioDurationSeconds);
  };

  console.log('[RenderVideosService] alignAudioToSentences called', {
    audioPath: params.audioPath,
    audioDurationSeconds: params.audioDurationSeconds,
    sentenceCount: params.sentences.length,
    hasOpenAI: !!params.openai,
    disableRenderer: !!params.disableRenderer,
  });

  if (!params.openai) {
    console.log('[RenderVideosService] OpenAI client not configured, using fallback alignment');
    return fallback();
  }

  if (!fs.existsSync(params.audioPath)) {
    console.warn('[RenderVideosService] Audio file not found for alignment', {
      audioPath: params.audioPath,
    });
    return fallback();
  }

  try {
    const model = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe';
    const responseFormat = model.startsWith('gpt-4o') ? 'json' : 'verbose_json';

    console.log('[RenderVideosService] Calling OpenAI audio.transcriptions.create', {
      model,
      responseFormat,
    });

    const transcription: any = await params.withTimeout(
      params.openai.audio.transcriptions.create({
        file: fs.createReadStream(params.audioPath),
        model,
        response_format: responseFormat as any,
      } as any),
      Number(process.env.OPENAI_TRANSCRIBE_TIMEOUT_MS ?? '120000'),
      'OpenAI transcription',
    );

    let segments: any[] = Array.isArray(transcription?.segments) ? transcription.segments : [];

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
        params.openai.audio.transcriptions.create({
          file: fs.createReadStream(params.audioPath),
          model: whisperModel,
          response_format: 'verbose_json' as any,
        } as any),
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
        console.warn('[RenderVideosService] Whisper also returned no segments, using fallback alignment');
        return fallback();
      }
    }

    const normalizeWord = (raw: string) =>
      raw
        .toString()
        .toLowerCase()
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

    type WordTiming = {
      token: string;
      startSeconds: number;
      endSeconds: number;
    };

    const wordsTimeline: WordTiming[] = [];

    for (const seg of segments) {
      const segStartRaw = seg.start;
      const segEndRaw = seg.end;
      const segStart = typeof segStartRaw === 'number' ? segStartRaw : parseFloat(segStartRaw);
      const segEnd = typeof segEndRaw === 'number' ? segEndRaw : parseFloat(segEndRaw);

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
        wordsTimeline.push({ token, startSeconds: wStart, endSeconds: wEnd });
      }
    }

    if (!wordsTimeline.length) {
      console.warn('[RenderVideosService] No wordsTimeline built from transcription, using fallback alignment');
      return fallback();
    }

    const timings: SentenceTiming[] = [];
    let wordIndex = 0;

    const lastWordEnd =
      (wordsTimeline[wordsTimeline.length - 1]?.endSeconds ?? params.audioDurationSeconds) || 1;
    const T = Math.max(1, lastWordEnd);

    const cleaned = params.sentences.map((s) => (s.text || '').trim());
    const transcriptTokens = wordsTimeline.map((w) => w.token);

    const findBestMatch = (
      startFrom: number,
      sentenceTokens: string[],
    ): { start: number; end: number } | null => {
      if (!sentenceTokens.length) return null;

      const maxStart = transcriptTokens.length - sentenceTokens.length;
      if (maxStart < startFrom) return null;

      let bestScore = 0;
      let best: { start: number; end: number } | null = null;

      for (let i = startFrom; i <= maxStart; i += 1) {
        let matches = 0;
        for (let j = 0; j < sentenceTokens.length; j += 1) {
          if (transcriptTokens[i + j] === sentenceTokens[j]) {
            matches += 1;
          }
        }

        const score = matches / sentenceTokens.length;
        if (score > bestScore && score >= 0.5) {
          bestScore = score;
          best = { start: i, end: i + sentenceTokens.length - 1 };
        }
      }

      return best;
    };

    for (let i = 0; i < cleaned.length; i += 1) {
      const text = cleaned[i];

      if (!text) {
        const prevEnd = i > 0 ? timings[i - 1].endSeconds : 0;
        const endSeconds = Math.min(T, prevEnd + 0.1);
        timings.push({ index: i, text, startSeconds: prevEnd, endSeconds });
        continue;
      }

      const sentenceTokens = text
        .split(/\s+/u)
        .filter(Boolean)
        .map((t) => normalizeWord(t))
        .filter(Boolean);

      if (!sentenceTokens.length) {
        const prevEnd = i > 0 ? timings[i - 1].endSeconds : 0;
        const endSeconds = Math.min(T, prevEnd + 0.1);
        timings.push({ index: i, text, startSeconds: prevEnd, endSeconds });
        continue;
      }

      const match = findBestMatch(wordIndex, sentenceTokens);

      if (!match) {
        const prevEnd = timings.length ? timings[timings.length - 1].endSeconds : 0;
        const remainingDuration = Math.max(0.1, T - prevEnd);
        const remaining = alignByWordCount(params.sentences.slice(i), remainingDuration);

        for (const r of remaining) {
          timings.push({
            index: i + r.index,
            text: r.text,
            startSeconds: prevEnd + r.startSeconds,
            endSeconds: prevEnd + r.endSeconds,
          });
        }

        break;
      }

      const firstWord = wordsTimeline[match.start];
      const lastWord = wordsTimeline[match.end];

      let startSeconds = firstWord.startSeconds;
      let endSeconds = lastWord.endSeconds;

      if (!Number.isFinite(startSeconds)) startSeconds = 0;
      if (!Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
        endSeconds = startSeconds + 0.1;
      }

      startSeconds = Math.max(0, Math.min(startSeconds, T));
      endSeconds = Math.max(startSeconds + 0.05, Math.min(endSeconds, T));

      timings.push({ index: i, text, startSeconds, endSeconds });
      wordIndex = match.end + 1;
    }

    if (timings.length) {
      const last = timings[timings.length - 1];
      if (last.endSeconds < T) {
        last.endSeconds = T;
      }
    }

    console.log('[RenderVideosService] OpenAI-based alignment produced timings', {
      timingCount: timings.length,
    });

    return timings;
  } catch (err: any) {
    console.error('[RenderVideosService] Error during OpenAI alignment, using fallback', {
      message: err?.message,
    });
    return fallback();
  }
};
