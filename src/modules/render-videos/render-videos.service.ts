import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RenderJob } from './entities/render-job.entity';
import { join, basename, extname } from 'path';
import * as fs from 'fs';
import OpenAI from 'openai';

type SentenceInput = { text: string };

type SentenceTiming = {
  index: number;
  text: string;
  startSeconds: number;
  endSeconds: number;
};

const SUBSCRIBE_SENTENCE =
  'Please Subscribe & Help us reach out to more people';

@Injectable()
export class RenderVideosService {
  private readonly openai: OpenAI | null;

  constructor(
    @InjectRepository(RenderJob)
    private readonly jobsRepo: Repository<RenderJob>,
  ) {
    const apiKey = process.env.OPENAI_API_KEY;
    this.openai = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async createJob(params: {
    audioPath: string;
    sentences: SentenceInput[];
    imagePaths: string[];
    scriptLength: string;
    audioDurationSeconds?: number;
    useLowerFps?: boolean;
    useLowerResolution?: boolean;
    enableGlitchTransitions?: boolean;
  }) {
    const job = this.jobsRepo.create({
      status: 'queued',
      error: null,
      audioPath: params.audioPath,
      videoPath: null,
      timeline: null,
    });
    await this.jobsRepo.save(job);

    void this.processJob(job.id, params);

    return job;
  }

  async getJob(id: string) {
    const job = await this.jobsRepo.findOne({ where: { id } });
    if (!job) throw new NotFoundException('Render job not found');
    return job;
  }

  private isShort(scriptLength: string) {
    return scriptLength.trim().toLowerCase().startsWith('30');
  }

  private buildTimeline(params: {
    sentences: SentenceInput[];
    imagePaths: string[];
    scriptLength: string;
    audioDurationSeconds: number;
    audioSrc: string;
    sentenceTimings?: SentenceTiming[];
    subscribeVideoSrc?: string | null;
    useLowerFps?: boolean;
    useLowerResolution?: boolean;
    enableGlitchTransitions?: boolean;
  }) {
    const baseFps = 30;
    const fps = params.useLowerFps ? 24 : baseFps;
    const isShort = this.isShort(params.scriptLength);
    const width = isShort
      ? params.useLowerResolution
        ? 720
        : 1080
      : params.useLowerResolution
        ? 1280
        : 1920;
    const height = isShort
      ? params.useLowerResolution
        ? 1280
        : 1920
      : params.useLowerResolution
        ? 720
        : 1080;

    const T = Math.max(1, params.audioDurationSeconds || 1);
    const N = Math.max(1, params.sentences.length || 1);
    const glitchSceneIndex = params.enableGlitchTransitions
      ? Math.floor(N / 2)
      : -1;

    const scenes = params.sentences.map((s, index) => {
      const timing = params.sentenceTimings?.[index];

      const isSubscribe =
        (s.text || '').trim() === SUBSCRIBE_SENTENCE &&
        !!params.subscribeVideoSrc;

      const startSeconds =
        timing && typeof timing.startSeconds === 'number'
          ? Math.max(0, Math.min(timing.startSeconds, T))
          : (T * index) / N;
      const endSeconds =
        timing && typeof timing.endSeconds === 'number'
          ? Math.max(startSeconds + 1 / fps, Math.min(timing.endSeconds, T))
          : (T * (index + 1)) / N;
      const startFrame = Math.floor(startSeconds * fps);
      const durationFrames = Math.max(
        1,
        Math.ceil(endSeconds * fps) - startFrame,
      );
      return {
        index,
        text: s.text,
        imageSrc: params.imagePaths[index],
        videoSrc: isSubscribe ? params.subscribeVideoSrc : undefined,
        startFrame,
        durationFrames,
        useGlitch: index === glitchSceneIndex,
      };
    });

    const durationInFrames =
      scenes.length > 0
        ? scenes[scenes.length - 1].startFrame +
        scenes[scenes.length - 1].durationFrames
        : Math.ceil(T * fps);

    return {
      width,
      height,
      fps,
      durationInFrames,
      audioSrc: params.audioSrc,
      scenes,
    };
  }

  private getStorageRoot() {
    return join(process.cwd(), 'storage');
  }

  private ensureDir(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private getPublicVideoUrl(jobId: string) {
    const baseUrl =
      process.env.REMOTION_ASSET_BASE_URL ??
      `http://127.0.0.1:${process.env.PORT ?? 3000}`;
    const fileName = `${jobId}.mp4`;
    return `${baseUrl}/static/videos/${fileName}`;
  }

  getVideoFsPath(jobId: string) {
    const root = this.getStorageRoot();
    this.ensureDir(join(root, 'videos'));
    return join(root, 'videos', `${jobId}.mp4`);
  }

  private async renderWithRemotion(params: {
    timeline: any;
    outputFsPath: string;
    publicDir: string;
  }) {
    // Dynamic imports so that type checking works even if packages are not installed yet.
    const bundler: any = await import('@remotion/bundler');
    const renderer: any = await import('@remotion/renderer');

    const entryPoint = join(process.cwd(), 'remotion', 'src', 'index.tsx');

    const serveUrl = await bundler.bundle({
      entryPoint,
      publicDir: params.publicDir,
    });

    const compositions = await renderer.getCompositions(serveUrl, {
      inputProps: { timeline: params.timeline },
    });
    const composition = compositions.find(
      (c: any) => c.id === 'AutoVideo',
    ) ?? {
      id: 'AutoVideo',
      width: params.timeline.width,
      height: params.timeline.height,
      fps: params.timeline.fps,
      durationInFrames: params.timeline.durationInFrames,
    };

    await renderer.renderMedia({
      composition: {
        ...composition,
        width: params.timeline.width,
        height: params.timeline.height,
        fps: params.timeline.fps,
        durationInFrames: params.timeline.durationInFrames,
      },
      serveUrl,
      codec: 'h264',
      outputLocation: params.outputFsPath,
      inputProps: { timeline: params.timeline },
    });
  }

  private prepareRemotionPublicDir(jobId: string, params: {
    audioPath: string;
    imagePaths: string[];
  }) {
    const root = this.getStorageRoot();
    const publicDir = join(root, 'render-public', jobId);
    this.ensureDir(publicDir);
    this.ensureDir(join(publicDir, 'images'));

    const audioExt = extname(params.audioPath) || '.mp3';
    const audioDestName = `audio${audioExt}`;
    fs.copyFileSync(params.audioPath, join(publicDir, audioDestName));

    const imageSrcs: string[] = [];
    for (const p of params.imagePaths) {
      const name = basename(p);
      const dest = join(publicDir, 'images', name);
      fs.copyFileSync(p, dest);
      imageSrcs.push(`images/${name}`);
    }

    // Try to copy the subscribe.mp4 video and background.mp3 audio
    // from known public folders into this job's public directory.
    let subscribeVideoSrc: string | null = null;
    try {
      const videoSources = [
        // Preferred: backend Remotion public folder
        join(process.cwd(), 'remotion', 'public', 'subscribe.mp4'),
        // Legacy: frontend public folder
        join(process.cwd(), '..', 'frontend', 'public', 'subscribe.mp4'),
      ];

      for (const source of videoSources) {
        if (fs.existsSync(source)) {
          const dest = join(publicDir, 'subscribe.mp4');
          fs.copyFileSync(source, dest);
          subscribeVideoSrc = 'subscribe.mp4';
          break;
        }
      }
    } catch {
      // If copying fails, just skip the video; the scene will fall back to black.
    }

    try {
      const bgSources = [
        join(process.cwd(), 'remotion', 'public', 'background.mp3'),
        join(process.cwd(), '..', 'frontend', 'public', 'background.mp3'),
      ];

      for (const source of bgSources) {
        if (fs.existsSync(source)) {
          const dest = join(publicDir, 'background.mp3');
          fs.copyFileSync(source, dest);
          break;
        }
      }
    } catch {
      // Background music is optional; ignore copy errors.
    }

    try {
      const glitchSources = [
        join(process.cwd(), 'remotion', 'public', 'glitch-fx.mp3'),
        join(process.cwd(), '..', 'frontend', 'public', 'glitch-fx.mp3'),
      ];

      for (const source of glitchSources) {
        if (fs.existsSync(source)) {
          const dest = join(publicDir, 'glitch-fx.mp3');
          fs.copyFileSync(source, dest);
          break;
        }
      }
    } catch {
      // Glitch sound effect is optional; ignore copy errors.
    }

    return {
      publicDir,
      audioSrc: audioDestName,
      imageSrcs,
      subscribeVideoSrc,
    };
  }

  private async processJob(
    jobId: string,
    params: {
      audioPath: string;
      sentences: SentenceInput[];
      imagePaths: string[];
      scriptLength: string;
      audioDurationSeconds?: number;
        useLowerFps?: boolean;
        useLowerResolution?: boolean;      enableGlitchTransitions?: boolean;    },
  ) {
    try {
      const job = await this.getJob(jobId);
      job.status = 'processing';
      await this.jobsRepo.save(job);

      const durationSeconds =
        params.audioDurationSeconds && params.audioDurationSeconds > 0
          ? params.audioDurationSeconds
          : 1;

      const { publicDir, audioSrc, imageSrcs, subscribeVideoSrc } =
        this.prepareRemotionPublicDir(
          jobId,
          {
            audioPath: params.audioPath,
            imagePaths: params.imagePaths,
          },
        );

      // Align audio with sentences to get per-sentence timings.
      // Currently uses a word-based proportional approach and is structured
      // so that a real aligner (e.g. Whisper-based) can be plugged in later.
      const sentenceTimings = await this.alignAudioToSentences(
        params.audioPath,
        params.sentences,
        durationSeconds,
      );

      const timeline = this.buildTimeline({
        sentences: params.sentences,
        imagePaths: imageSrcs,
        scriptLength: params.scriptLength,
        audioDurationSeconds: durationSeconds,
        audioSrc,
        sentenceTimings,
        subscribeVideoSrc,
        useLowerFps: params.useLowerFps,
        useLowerResolution: params.useLowerResolution,
        enableGlitchTransitions: params.enableGlitchTransitions,
      });

      job.timeline = timeline;
      job.status = 'rendering';
      await this.jobsRepo.save(job);

      const outputFsPath = this.getVideoFsPath(jobId);
      await this.renderWithRemotion({ timeline, outputFsPath, publicDir });
      job.status = 'completed';
      job.videoPath = this.getPublicVideoUrl(jobId);
      await this.jobsRepo.save(job);
    } catch (err: any) {
      await this.jobsRepo.save({
        id: jobId,
        status: 'failed',
        error: err?.message || 'Failed to process render job',
      });
    }
  }

  /**
   * Computes per-sentence timings for the audio.
   *
   * This implementation uses a high-level, word-count-based proportional
   * distribution as a stand-in for a true forced aligner. It is structured
   * so you can later plug in a real alignment tool (e.g. WhisperX) that
   * returns precise start/end times for each sentence.
   */
  private async alignAudioToSentences(
    audioPath: string,
    sentences: SentenceInput[],
    audioDurationSeconds: number,
  ): Promise<SentenceTiming[]> {
    const fallback = () =>
      this.alignByVoiceActivity(audioPath, sentences, audioDurationSeconds);

    // Debug logging to inspect whether OpenAI-based alignment is used.
    // eslint-disable-next-line no-console
    console.log('[RenderVideosService] alignAudioToSentences called', {
      audioPath,
      audioDurationSeconds,
      sentenceCount: sentences.length,
      hasOpenAI: !!this.openai,
    });

    if (!this.openai) {
      // eslint-disable-next-line no-console
      console.log('[RenderVideosService] OpenAI client not configured, using fallback alignment');
      return fallback();
    }

    if (!fs.existsSync(audioPath)) {
      // eslint-disable-next-line no-console
      console.warn('[RenderVideosService] Audio file not found for alignment', {
        audioPath,
      });
      return fallback();
    }

    try {
      const model =
        process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe';
      // Newer GPT-4o-based transcription models only support 'json' or 'text'.
      const responseFormat = model.startsWith('gpt-4o') ? 'json' : 'verbose_json';

      // eslint-disable-next-line no-console
      console.log('[RenderVideosService] Calling OpenAI audio.transcriptions.create', {
        model,
        responseFormat,
      });

      const transcription: any =
        await this.openai.audio.transcriptions.create({
          file: fs.createReadStream(audioPath),
          model,
          response_format: responseFormat as any,
        } as any);

      let segments: any[] = Array.isArray(transcription?.segments)
        ? transcription.segments
        : [];

      // eslint-disable-next-line no-console
      console.log('[RenderVideosService] OpenAI transcription result', {
        hasSegments: Array.isArray(transcription?.segments),
        segmentCount: segments.length,
      });

      if (!segments.length) {
        // If the chosen model (e.g. gpt-4o-transcribe) does not return
        // word-level segments, fall back to Whisper, which does.
        const whisperModel = 'whisper-1';
        // eslint-disable-next-line no-console
        console.warn(
          '[RenderVideosService] Primary transcription model returned no segments; retrying with Whisper',
          { primaryModel: model, whisperModel },
        );

        const whisperTranscription: any =
          await this.openai.audio.transcriptions.create({
            file: fs.createReadStream(audioPath),
            model: whisperModel,
            response_format: 'verbose_json' as any,
          } as any);

        segments = Array.isArray(whisperTranscription?.segments)
          ? whisperTranscription.segments
          : [];

        // eslint-disable-next-line no-console
        console.log('[RenderVideosService] Whisper transcription result', {
          hasSegments: Array.isArray(whisperTranscription?.segments),
          segmentCount: segments.length,
        });

        if (!segments.length) {
          // eslint-disable-next-line no-console
          console.warn('[RenderVideosService] Whisper also returned no segments, using fallback alignment');
          return fallback();
        }
      }

      const normalizeWord = (raw: string) =>
        raw
          .toString()
          .toLowerCase()
          // Trim leading/trailing punctuation so "world!" matches "world".
          .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

      type WordTiming = {
        token: string;
        startSeconds: number;
        endSeconds: number;
      };
      const wordsTimeline: WordTiming[] = [];

      for (const seg of segments) {
        const segStartRaw = (seg as any).start;
        const segEndRaw = (seg as any).end;
        const segStart =
          typeof segStartRaw === 'number'
            ? segStartRaw
            : parseFloat(segStartRaw);
        const segEnd =
          typeof segEndRaw === 'number' ? segEndRaw : parseFloat(segEndRaw);

        if (!Number.isFinite(segStart) || !Number.isFinite(segEnd)) continue;
        if (segEnd <= segStart) continue;

        const rawText = (seg as any).text ?? '';
        const text = rawText.toString().trim();
        if (!text) continue;

        const tokens = text.split(/\s+/u).filter(Boolean);
        const span = segEnd - segStart;
        const count = tokens.length || 1;

        for (let i = 0; i < count; i += 1) {
          const wStart = segStart + (span * i) / count;
          const wEnd = segStart + (span * (i + 1)) / count;
          const token = normalizeWord(tokens[i] ?? '');
          if (!token) {
            continue;
          }
          wordsTimeline.push({ token, startSeconds: wStart, endSeconds: wEnd });
        }
      }

      if (!wordsTimeline.length) {
        // eslint-disable-next-line no-console
        console.warn('[RenderVideosService] No wordsTimeline built from transcription, using fallback alignment');
        return fallback();
      }

      const timings: SentenceTiming[] = [];
      let wordIndex = 0;

      const lastWordEnd =
        (wordsTimeline[wordsTimeline.length - 1]?.endSeconds ??
          audioDurationSeconds) ||
        1;
      const T = Math.max(1, lastWordEnd);

      const cleaned = sentences.map((s) => (s.text || '').trim());
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
          const prevEnd =
            i > 0 ? timings[i - 1].endSeconds : 0;
          const endSeconds = Math.min(T, prevEnd + 0.1);
          timings.push({
            index: i,
            text,
            startSeconds: prevEnd,
            endSeconds,
          });
          continue;
        }

        const sentenceTokens = text
          .split(/\s+/u)
          .filter(Boolean)
          .map((t) => normalizeWord(t))
          .filter(Boolean);

        if (!sentenceTokens.length) {
          const prevEnd =
            i > 0 ? timings[i - 1].endSeconds : 0;
          const endSeconds = Math.min(T, prevEnd + 0.1);
          timings.push({
            index: i,
            text,
            startSeconds: prevEnd,
            endSeconds,
          });
          continue;
        }

        const match = findBestMatch(wordIndex, sentenceTokens);

        if (!match) {
          const prevEnd = timings.length ? timings[timings.length - 1].endSeconds : 0;
          const remainingDuration = Math.max(0.1, T - prevEnd);
          const remaining = this.alignByWordCount(
            sentences.slice(i),
            remainingDuration,
          );

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

        if (!Number.isFinite(startSeconds)) {
          startSeconds = 0;
        }
        if (!Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
          endSeconds = startSeconds + 0.1;
        }

        startSeconds = Math.max(0, Math.min(startSeconds, T));
        endSeconds = Math.max(startSeconds + 0.05, Math.min(endSeconds, T));

        timings.push({
          index: i,
          text,
          startSeconds,
          endSeconds,
        });

        wordIndex = match.end + 1;
      }

      if (timings.length) {
        const last = timings[timings.length - 1];
        if (last.endSeconds < T) {
          last.endSeconds = T;
        }
      }

      // eslint-disable-next-line no-console
      console.log('[RenderVideosService] OpenAI-based alignment produced timings', {
        timingCount: timings.length,
      });

      return timings;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[RenderVideosService] Error during OpenAI alignment, using fallback', {
        message: (err as any)?.message,
      });
      return fallback();
    }
  }

  private async alignByVoiceActivity(
    audioPath: string,
    sentences: SentenceInput[],
    audioDurationSeconds: number,
  ): Promise<SentenceTiming[]> {
    try {
      // Use Remotion's audio analysis to detect silent and audible parts
      // so that pauses in the voice-over are reflected in the timing.
      const { getSilentParts } = await import('@remotion/renderer');
      const result: any = await getSilentParts({
        src: audioPath,
        // Ignore very short gaps; treat longer gaps as real pauses.
        minDurationInSeconds: 0.2,
        noiseThresholdInDecibels: -35,
      });

      const audible = Array.isArray(result?.audibleParts)
        ? result.audibleParts
        : [];

      if (!audible.length) {
        return this.alignByWordCount(sentences, audioDurationSeconds);
      }

      const segments = audible
        .map((p: any) => ({
          start: Number(p.startInSeconds),
          end: Number(p.endInSeconds),
        }))
        .filter((p) => Number.isFinite(p.start) && Number.isFinite(p.end) && p.end > p.start)
        .sort((a, b) => a.start - b.start);

      if (!segments.length) {
        return this.alignByWordCount(sentences, audioDurationSeconds);
      }

      const voicedDuration = segments.reduce(
        (sum, s) => sum + (s.end - s.start),
        0,
      );

      if (!Number.isFinite(voicedDuration) || voicedDuration <= 0) {
        return this.alignByWordCount(sentences, audioDurationSeconds);
      }

      // First, compute timings on a "compressed" timeline that only
      // contains the voiced parts (no silences) so that sentences are
      // distributed proportionally by word count over spoken time only.
      const compressedTimings = this.alignByWordCount(
        sentences,
        voicedDuration,
      );

      // Build a mapping from compressed time -> real time that inserts
      // back all the silent gaps between voiced segments.
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
        const realEnd = Math.max(
          realStart + 0.05,
          mapTime(t.endSeconds),
        );

        return {
          index: t.index,
          text: t.text,
          startSeconds: realStart,
          endSeconds: realEnd,
        };
      });

      const realDuration = Number(result?.durationInSeconds) || audioDurationSeconds || 1;
      const T = Math.max(1, realDuration);

      // Clamp everything to the actual audio duration and ensure
      // the last sentence ends exactly at T.
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
      // If audio analysis fails for any reason, fall back to
      // simple proportional alignment.
      return this.alignByWordCount(sentences, audioDurationSeconds);
    }
  }

  private alignByWordCount(
    sentences: SentenceInput[],
    audioDurationSeconds: number,
  ): SentenceTiming[] {
    const T = Math.max(1, audioDurationSeconds || 1);
    const cleaned = sentences.map((s) => (s.text || '').trim());

    // Compute a simple weight per sentence based on word count, with a
    // small floor so very short sentences still receive some time.
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

      // Ensure the very last sentence ends exactly at T to avoid small gaps
      // or overshoots due to rounding.
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
  }
}


