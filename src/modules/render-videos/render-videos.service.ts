import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RenderJob } from './entities/render-job.entity';
import { join, extname } from 'path';
import * as fs from 'fs';
import * as os from 'os';
import OpenAI from 'openai';

import type {
  SentenceInput,
  SentenceTiming,
  UploadedAsset,
} from './render-videos.types';
import {
  CHROMA_LEAK_SFX_CLOUDINARY_URL,
  SUBSCRIBE_SENTENCE,
  SUBSCRIBE_VIDEO_CLOUDINARY_URL,
} from './render-videos.constants';
import {
  buildTimeline as buildTimelineExternal,
  isShortScript,
} from './timeline.builder';
import { alignAudioToSentences as alignAudioToSentencesExternal } from './alignment/audio-alignment';
import { downloadUrlToBuffer as downloadUrlToBufferExternal } from './utils/net.utils';
import { inferExt as inferExtExternal } from './utils/mime.utils';
import {
  isCloudinaryUrl as isCloudinaryUrlExternal,
  isServerlessRuntime,
} from './utils/runtime.utils';
import { withTimeout as withTimeoutExternal } from './utils/promise.utils';
import {
  ensureDir as ensureDirExternal,
  safeCopyFile as safeCopyFileExternal,
  safeRmDir as safeRmDirExternal,
} from './utils/fs.utils';
import {
  ensureCloudinaryConfigured as ensureCloudinaryConfiguredExternal,
  uploadBufferToCloudinary as uploadBufferToCloudinaryExternal,
  uploadVideoFileToCloudinary,
} from './utils/cloudinary.utils';
import {
  REMOTION_BACKGROUND_REL,
  REMOTION_CAMERA_CLICK_SFX_REL,
  REMOTION_CHROMA_LEAK_SFX_REL,
  REMOTION_GLITCH_SFX_REL,
  REMOTION_SUBSCRIBE_VIDEO_REL,
  REMOTION_SUSPENSE_GLITCH_SFX_REL,
  REMOTION_VOICEOVER_REL,
  REMOTION_WHOOSH_SFX_REL,
  shouldUseRemotionLambda,
} from './remotion/remotion.config';
import {
  renderWithRemotionLocal as renderWithRemotionLocalExternal,
  renderWithRemotionOnLambda as renderWithRemotionOnLambdaExternal,
} from './remotion/remotion-render';

@Injectable()
export class RenderVideosService implements OnModuleInit {
  private readonly openai: OpenAI | null;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(RenderJob)
    private readonly jobsRepo: Repository<RenderJob>,
  ) {
    const apiKey = process.env.OPENAI_API_KEY;
    this.openai = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async onModuleInit() {
    await this.ensureRenderJobsSchema();
  }

  private async ensureRenderJobsSchema() {
    // Older DBs may have the render_jobs table without newer columns.
    // This guard avoids runtime errors like:
    // QueryFailedError: column RenderJob.lastProgressAt does not exist
    try {
      await this.dataSource.query(
        'ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS "lastProgressAt" TIMESTAMP NULL',
      );
    } catch (err: any) {
      const message = String(err?.message || '');
      // Ignore if table doesn't exist yet (fresh DB), or if permissions prevent ALTER.
      if (
        message.includes('does not exist') ||
        message.includes('permission denied')
      ) {
        return;
      }
      throw err;
    }
  }

  private isCloudinaryUrl(url: string): boolean {
    return isCloudinaryUrlExternal(url);
  }

  private useLambdaTestMode(): boolean {
    // Legacy name kept for backwards compatibility.
    return shouldUseRemotionLambda();
  }

  async createJob(params: {
    audioFile: UploadedAsset | null;
    audioUrl?: string | null;
    sentences: SentenceInput[];
    imageFiles: Array<UploadedAsset | null>;
    imageUrls?: Array<string | null> | null;
    scriptLength: string;
    audioDurationSeconds?: number;
    isShort?: boolean;
    useLowerFps?: boolean;
    useLowerResolution?: boolean;
    enableGlitchTransitions?: boolean;
  }) {
    const job = this.jobsRepo.create({
      status: 'queued',
      error: null,
      // audioPath is required by the DB schema; store a non-local placeholder.
      audioPath: '',
      videoPath: null,
      timeline: null,
      lastProgressAt: new Date(),
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
    return isShortScript(scriptLength);
  }

  private async downloadUrlToBuffer(params: {
    url: string;
    maxBytes: number;
    label: string;
  }): Promise<{ buffer: Buffer; mimeType?: string }> {
    return downloadUrlToBufferExternal(params);
  }

  private buildTimeline(params: {
    sentences: SentenceInput[];
    imagePaths: string[];
    scriptLength: string;
    audioDurationSeconds: number;
    audioSrc: string;
    sentenceTimings?: SentenceTiming[];
    subscribeVideoSrc?: string | null;
    isShort?: boolean;
    useLowerFps?: boolean;
    useLowerResolution?: boolean;
    enableGlitchTransitions?: boolean;
  }) {
    return buildTimelineExternal(params);
  }

  private getStorageRoot() {
    const isServerless = this.isServerlessRuntime();

    // Vercel/Lambda file system is read-only except for os.tmpdir().
    // We only need a scratch space for Remotion rendering because the final
    // output is uploaded to Cloudinary.
    if (isServerless) {
      return join(os.tmpdir(), 'auto-video-generator');
    }

    return join(process.cwd(), 'storage');
  }

  isServerlessRuntime() {
    return isServerlessRuntime();
  }

  private startHeartbeat(jobId: string, intervalMs = 30_000) {
    const timer = setInterval(() => {
      void this.jobsRepo
        .save({
          id: jobId,
          lastProgressAt: new Date(),
        } as any)
        .catch(() => undefined);
    }, intervalMs);

    (timer as any).unref?.();
    return () => clearInterval(timer);
  }

  async failIfStale(job: RenderJob) {
    if (!job) return;
    if (job.status !== 'processing' && job.status !== 'rendering') return;

    const progressAt =
      job.lastProgressAt instanceof Date
        ? job.lastProgressAt
        : job.updatedAt instanceof Date
          ? job.updatedAt
          : null;
    if (!progressAt) return;

    // If the platform kills the function mid-render, the job can be stuck forever.
    // Mark it failed after a reasonable timeout so the UI doesn't spin indefinitely.
    const staleMinutesRaw = Number(
      process.env.RENDER_JOB_STALE_MINUTES ?? '45',
    );
    const staleMinutes = Number.isFinite(staleMinutesRaw)
      ? Math.max(15, staleMinutesRaw)
      : 45;
    const STALE_MS = staleMinutes * 60_000;

    const ageMs = Date.now() - progressAt.getTime();
    if (ageMs < STALE_MS) return;

    const hint = this.isServerlessRuntime()
      ? 'likely killed by serverless runtime'
      : 'likely crashed, ran out of memory, or got stuck';

    await this.jobsRepo.save({
      id: job.id,
      status: 'failed',
      error: `Render job became stale (${hint}). Check backend logs and consider lowering resolution/FPS or increasing Node memory.`,
    });
  }

  private ensureDir(dir: string) {
    ensureDirExternal(dir);
  }

  private inferExt(params: {
    originalName?: string;
    mimeType?: string;
    fallback: string;
  }) {
    return inferExtExternal(params);
  }

  private getRemotionPublicRootDir() {
    const root = this.getStorageRoot();
    const publicRoot = join(root, 'render-public');
    this.ensureDir(publicRoot);
    return publicRoot;
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label: string,
  ): Promise<T> {
    return withTimeoutExternal(promise, ms, label);
  }

  private ensureCloudinaryConfigured() {
    ensureCloudinaryConfiguredExternal();
  }

  private async uploadBufferToCloudinary(params: {
    buffer: Buffer;
    folder: string;
    resource_type: 'image' | 'video';
  }): Promise<{ secure_url: string; public_id: string }> {
    return uploadBufferToCloudinaryExternal(params);
  }

  private createTempDir(prefix: string) {
    return fs.mkdtempSync(join(os.tmpdir(), prefix));
  }

  private safeRmDir(dir: string) {
    safeRmDirExternal(dir);
  }

  private safeCopyFile(src: string, dest: string) {
    safeCopyFileExternal(src, dest);
  }

  private getRemotionPublicAssetsDir() {
    return join(process.cwd(), 'remotion', 'public');
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
    jobId?: string;
    timeline: any;
    outputFsPath: string;
    publicDir: string;
  }) {
    if (shouldUseRemotionLambda()) {
      await renderWithRemotionOnLambdaExternal({
        jobId: params.jobId,
        timeline: params.timeline,
        outputFsPath: params.outputFsPath,
        onProgress: params.jobId
          ? async () => {
              await this.jobsRepo
                .save({ id: params.jobId, lastProgressAt: new Date() } as any)
                .catch(() => undefined);
            }
          : undefined,
      });
      return;
    }

    await renderWithRemotionLocalExternal({
      timeline: params.timeline,
      outputFsPath: params.outputFsPath,
      publicDir: params.publicDir,
    });
  }

  private prepareRemotionPublicDir(jobId: string) {
    const publicRoot = this.getRemotionPublicRootDir();
    const jobDir = join(publicRoot, jobId);
    this.ensureDir(jobDir);
    this.ensureDir(join(jobDir, 'images'));
    this.ensureDir(join(jobDir, 'audio'));
    this.ensureDir(join(jobDir, 'sfx'));
    this.ensureDir(join(jobDir, 'videos'));

    return {
      // Use a job-scoped publicDir so Remotion bundling includes the job's assets.
      publicDir: jobDir,
      jobDir,
      subscribeVideoSrc: REMOTION_SUBSCRIBE_VIDEO_REL,
    };
  }

  private async processJob(
    jobId: string,
    params: {
      audioFile: UploadedAsset | null;
      audioUrl?: string | null;
      sentences: SentenceInput[];
      imageFiles: Array<UploadedAsset | null>;
      imageUrls?: Array<string | null> | null;
      scriptLength: string;
      audioDurationSeconds?: number;
      isShort?: boolean;
      useLowerFps?: boolean;
      useLowerResolution?: boolean;
      enableGlitchTransitions?: boolean;
    },
  ) {
    const tempDir = this.createTempDir('auto-video-generator-');
    let publicDirToClean: string | null = null;
    let stopHeartbeat: (() => void) | null = null;
    try {
      const job = await this.getJob(jobId);
      job.status = 'processing';
      job.lastProgressAt = new Date();
      await this.jobsRepo.save(job);

      stopHeartbeat = this.startHeartbeat(jobId);

      const hasAudioBuffer = !!params.audioFile?.buffer?.length;
      const hasAudioUrl = !!params.audioUrl;
      if (!hasAudioBuffer && !hasAudioUrl) {
        throw new Error('Missing voiceOver audio file');
      }

      let audioBuffer: Buffer;
      let audioName: string;
      let audioMimeType: string | undefined;

      if (hasAudioBuffer && params.audioFile) {
        // Upload audio to Cloudinary and use the URL inside Remotion.
        const uploadedAudio = await this.uploadBufferToCloudinary({
          buffer: params.audioFile.buffer,
          folder: 'auto-video-generator/render-inputs/audio',
          resource_type: 'video',
        });
        job.audioPath = uploadedAudio.secure_url;
        await this.jobsRepo.save(job);

        audioBuffer = params.audioFile.buffer;
        audioName = params.audioFile.originalName || 'audio.mp3';
        audioMimeType = params.audioFile.mimeType;
      } else {
        // audioUrl must be a public URL; if it's not Cloudinary, re-host it on Cloudinary.
        const downloaded = await this.downloadUrlToBuffer({
          url: String(params.audioUrl),
          maxBytes: 30 * 1024 * 1024,
          label: 'voiceOver audioUrl',
        });
        audioBuffer = downloaded.buffer;
        audioMimeType = downloaded.mimeType;
        audioName = 'audio.mp3';

        const audioUrlString = String(params.audioUrl);
        if (this.isCloudinaryUrl(audioUrlString)) {
          job.audioPath = audioUrlString;
        } else {
          const uploadedAudio = await this.uploadBufferToCloudinary({
            buffer: audioBuffer,
            folder: 'auto-video-generator/render-inputs/audio',
            resource_type: 'video',
          });
          job.audioPath = uploadedAudio.secure_url;
        }
        await this.jobsRepo.save(job);
      }

      // Create a temporary local audio file for alignment and audio analysis.
      // This is not persisted in project storage.
      const audioExt = extname(audioName || '') || '.mp3';
      const tempAudioPath = join(tempDir, `audio${audioExt}`);
      fs.writeFileSync(tempAudioPath, audioBuffer);

      const durationSeconds =
        params.audioDurationSeconds && params.audioDurationSeconds > 0
          ? params.audioDurationSeconds
          : 1;

      const useLambdaTestMode = this.useLambdaTestMode();

      // In Lambda test-mode, we must use public URLs (Lambda can't access our local filesystem).
      // In local mode, we keep the job-scoped publicDir approach.
      let publicDir = '';
      let subscribeVideoSrc: string | null = null;
      let voiceoverAudioSrc = '';
      const imageSrcs: string[] = [];

      const providedUrls = Array.isArray(params.imageUrls)
        ? params.imageUrls
        : null;
      if (providedUrls && providedUrls.length !== params.sentences.length) {
        throw new Error('imageUrls length must match sentences length');
      }

      const hasSubscribeSentence = params.sentences.some(
        (s) => (s?.text || '').trim() === SUBSCRIBE_SENTENCE,
      );

      if (useLambdaTestMode) {
        // Voiceover: always Cloudinary URL
        if (!job.audioPath) {
          throw new Error('audioPath missing after Cloudinary upload');
        }
        voiceoverAudioSrc = job.audioPath;

        subscribeVideoSrc = hasSubscribeSentence
          ? SUBSCRIBE_VIDEO_CLOUDINARY_URL
          : null;

        for (let i = 0; i < params.sentences.length; i += 1) {
          const sentenceText = (params.sentences[i]?.text || '').trim();
          const isSubscribe = sentenceText === SUBSCRIBE_SENTENCE;
          if (isSubscribe) {
            imageSrcs.push('');
            continue;
          }

          const wantsVideo =
            params.sentences[i]?.mediaType === 'video' &&
            !!String(params.sentences[i]?.videoUrl ?? '').trim();
          if (wantsVideo) {
            imageSrcs.push('');
            continue;
          }

          const url = providedUrls ? providedUrls[i] : null;
          if (url) {
            const urlString = String(url);
            if (this.isCloudinaryUrl(urlString)) {
              imageSrcs.push(urlString);
              continue;
            }

            // Re-host non-Cloudinary URLs to reduce risk of hotlinking issues during Lambda render.
            const downloaded = await this.downloadUrlToBuffer({
              url: urlString,
              maxBytes: 12 * 1024 * 1024,
              label: `imageUrl for sentence ${i + 1}`,
            });

            const uploaded = await this.uploadBufferToCloudinary({
              buffer: downloaded.buffer,
              folder: 'auto-video-generator/render-inputs/images',
              resource_type: 'image',
            });

            imageSrcs.push(uploaded.secure_url);
            continue;
          }

          const file = params.imageFiles[i];
          if (!file?.buffer) {
            throw new Error(
              `Missing image upload for sentence ${i + 1} (non-subscribe sentence)`,
            );
          }

          const uploaded = await this.uploadBufferToCloudinary({
            buffer: file.buffer,
            folder: 'auto-video-generator/render-inputs/images',
            resource_type: 'image',
          });

          imageSrcs.push(uploaded.secure_url);
        }
      } else {
        const prepared = this.prepareRemotionPublicDir(jobId);
        const jobDir = prepared.jobDir;
        publicDir = prepared.publicDir;
        subscribeVideoSrc = hasSubscribeSentence
          ? prepared.subscribeVideoSrc
          : null;
        publicDirToClean = jobDir;

        // Materialize required Remotion assets into the job-scoped publicDir.
        fs.writeFileSync(join(jobDir, REMOTION_VOICEOVER_REL), audioBuffer);

        const remotionAssetsDir = this.getRemotionPublicAssetsDir();
        this.safeCopyFile(
          join(remotionAssetsDir, 'background_3.mp3'),
          join(jobDir, REMOTION_BACKGROUND_REL),
        );
        this.safeCopyFile(
          join(remotionAssetsDir, 'glitch-fx.mp3'),
          join(jobDir, REMOTION_GLITCH_SFX_REL),
        );
        this.safeCopyFile(
          join(remotionAssetsDir, 'whoosh.mp3'),
          join(jobDir, REMOTION_WHOOSH_SFX_REL),
        );
        this.safeCopyFile(
          join(remotionAssetsDir, 'camera_click.mp3'),
          join(jobDir, REMOTION_CAMERA_CLICK_SFX_REL),
        );
        this.safeCopyFile(
          join(remotionAssetsDir, 'suspense-glitch.mp3'),
          join(jobDir, REMOTION_SUSPENSE_GLITCH_SFX_REL),
        );

        if (hasSubscribeSentence) {
          this.safeCopyFile(
            join(remotionAssetsDir, 'subscribe.mp4'),
            join(jobDir, REMOTION_SUBSCRIBE_VIDEO_REL),
          );
        }

        const chromaDownloaded = await this.downloadUrlToBuffer({
          url: CHROMA_LEAK_SFX_CLOUDINARY_URL,
          maxBytes: 20 * 1024 * 1024,
          label: 'chroma leak sfx',
        });
        fs.writeFileSync(
          join(jobDir, REMOTION_CHROMA_LEAK_SFX_REL),
          chromaDownloaded.buffer,
        );

        voiceoverAudioSrc = REMOTION_VOICEOVER_REL;

        for (let i = 0; i < params.sentences.length; i += 1) {
          const sentenceText = (params.sentences[i]?.text || '').trim();
          const isSubscribe = sentenceText === SUBSCRIBE_SENTENCE;
          if (isSubscribe) {
            imageSrcs.push('');
            continue;
          }

          const wantsVideo =
            params.sentences[i]?.mediaType === 'video' &&
            !!String(params.sentences[i]?.videoUrl ?? '').trim();
          if (wantsVideo) {
            imageSrcs.push('');
            continue;
          }

          const url = providedUrls ? providedUrls[i] : null;
          const relBase = `images/scene-${String(i + 1).padStart(3, '0')}`;

          if (url) {
            const urlString = String(url);
            const downloaded = await this.downloadUrlToBuffer({
              url: urlString,
              maxBytes: 12 * 1024 * 1024,
              label: `imageUrl for sentence ${i + 1}`,
            });

            const ext = this.inferExt({
              originalName: urlString,
              mimeType: downloaded.mimeType,
              fallback: '.png',
            });

            const rel = `${relBase}${ext}`;
            fs.writeFileSync(join(jobDir, rel), downloaded.buffer);
            imageSrcs.push(rel);
            continue;
          }

          const file = params.imageFiles[i];
          if (!file?.buffer) {
            throw new Error(
              `Missing image upload for sentence ${i + 1} (non-subscribe sentence)`,
            );
          }

          const ext = this.inferExt({
            originalName: file.originalName,
            mimeType: file.mimeType,
            fallback: '.png',
          });

          const rel = `${relBase}${ext}`;
          fs.writeFileSync(join(jobDir, rel), file.buffer);
          imageSrcs.push(rel);
        }
      }

      // Align audio with sentences to get per-sentence timings.
      // Currently uses a word-based proportional approach and is structured
      // so that a real aligner (e.g. Whisper-based) can be plugged in later.
      const sentenceTimings = await this.alignAudioToSentences(
        tempAudioPath,
        params.sentences,
        durationSeconds,
      );

      const timeline = this.buildTimeline({
        sentences: params.sentences,
        imagePaths: imageSrcs,
        scriptLength: params.scriptLength,
        audioDurationSeconds: durationSeconds,
        audioSrc: voiceoverAudioSrc,
        sentenceTimings,
        subscribeVideoSrc,
        isShort: params.isShort,
        useLowerFps: params.useLowerFps,
        useLowerResolution: params.useLowerResolution,
        enableGlitchTransitions: params.enableGlitchTransitions,
      });

      job.timeline = timeline;
      job.status = 'rendering';
      job.lastProgressAt = new Date();
      await this.jobsRepo.save(job);

      const outputFsPath = this.getVideoFsPath(jobId);
      await this.withTimeout(
        this.renderWithRemotion({ jobId, timeline, outputFsPath, publicDir }),
        20 * 60_000,
        'Remotion render',
      );

      const videoUrl = await uploadVideoFileToCloudinary({
        filePath: outputFsPath,
        folder: 'auto-video-generator/videos',
        timeoutMs: 20 * 60_000,
      });

      try {
        fs.unlinkSync(outputFsPath);
      } catch {
        // ignore
      }

      job.status = 'completed';
      job.videoPath = videoUrl;
      await this.jobsRepo.save(job);
    } catch (err: any) {
      await this.jobsRepo.save({
        id: jobId,
        status: 'failed',
        error: err?.message || 'Failed to process render job',
      });
    } finally {
      if (stopHeartbeat) stopHeartbeat();
      this.safeRmDir(tempDir);
      if (publicDirToClean) {
        this.safeRmDir(publicDirToClean);
      }
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
    return alignAudioToSentencesExternal({
      openai: this.openai,
      audioPath,
      sentences,
      audioDurationSeconds,
      withTimeout: withTimeoutExternal,
      disableRenderer: shouldUseRemotionLambda(),
    });
  }
}
