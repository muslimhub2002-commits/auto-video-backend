import {
  Injectable,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RenderJob } from './entities/render-job.entity';
import { join, extname } from 'path';
import * as fs from 'fs';
import * as os from 'os';
import OpenAI from 'openai';
import { getVideoMetadata } from '@remotion/renderer';

import type {
  SentenceInput,
  SentenceTiming,
  UploadedAsset,
} from './render-videos.types';
import {
  resolveTextSceneBackgroundMode,
  sentenceUsesPrimaryImageTransport,
} from './render-videos.types';
import {
  CHROMA_LEAK_SFX_CLOUDINARY_URL,
  SUBSCRIBE_VIDEO_CLOUDINARY_URL,
  isSubscribeLikeSentence,
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
  safeCopyDirContents as safeCopyDirContentsExternal,
  safeCopyFile as safeCopyFileExternal,
  safeRmDir as safeRmDirExternal,
} from './utils/fs.utils';
import { uploadBufferToCloudinary as uploadBufferToCloudinaryExternal } from './utils/cloudinary.utils';
import {
  REMOTION_BACKGROUND_REL,
  REMOTION_CAMERA_CLICK_SFX_REL,
  REMOTION_CHROMA_LEAK_SFX_REL,
  REMOTION_GLITCH_SFX_REL,
  REMOTION_SUBSCRIBE_LONG_FORM_VIDEO_REL,
  REMOTION_SUBSCRIBE_VIDEO_REL,
  REMOTION_SUSPENSE_GLITCH_SFX_REL,
  REMOTION_VOICEOVER_REL,
  REMOTION_WHOOSH_SFX_REL,
  shouldUseRemotionLambda,
} from './remotion/remotion.config';
import {
  renderWithRemotionLocal as renderWithRemotionLocalExternal,
  renderWithRemotionOnLambda as renderWithRemotionOnLambdaExternal,
  resolveRemotionRenderTimeoutMs,
} from './remotion/remotion-render';

@Injectable()
export class RenderVideosService implements OnModuleInit {
  private readonly openai: OpenAI | null;
  private longFormSubscribeOverlayDurationSeconds: number | null = null;

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
    await this.failOrphanedJobsOnStartup();
  }

  private async failOrphanedJobsOnStartup() {
    // Restarts (watch mode/crashes) can leave jobs stuck in `processing`/`rendering`
    // with no worker attached. We cannot resume them, so fail *stale* jobs with a
    // clear error message.
    //
    // NOTE: Some setups run `nest start --watch` with NODE_ENV=production, so we
    // also treat watch mode as a signal to run this cleanup.
    const nodeEnv = (process.env.NODE_ENV ?? '').toLowerCase();
    const isProduction = nodeEnv === 'production';
    const isWatchMode =
      String(process.env.NEST_WATCH ?? '').toLowerCase() === 'true' ||
      Boolean(process.env.NEST_WATCH);

    const staleMinutesRaw = process.env.RENDER_JOBS_STALE_MINUTES;
    const staleMinutes = Number.isFinite(Number(staleMinutesRaw))
      ? Math.max(1, Number(staleMinutesRaw))
      : isProduction
        ? 12 * 60
        : 10;

    try {
      const message =
        'Render worker restarted while this job was running. Please start a new render.';
      const updated = await this.dataSource.query(
        'UPDATE render_jobs SET status = $1, error = $2 WHERE trim(lower(status)) IN ($3, $4) AND ("lastProgressAt" IS NULL OR "lastProgressAt" < NOW() - ($5 * INTERVAL \'1 minute\')) RETURNING id',
        ['failed', message, 'processing', 'rendering', staleMinutes],
      );

      console.log(
        `[render-jobs] Startup cleanup ran (env=${nodeEnv || 'unset'}, watch=${isWatchMode}, staleMinutes=${staleMinutes}). Updated=${
          Array.isArray(updated) ? updated.length : 0
        }`,
      );

      if (Array.isArray(updated) && updated.length > 0) {
        console.log(
          `[render-jobs] Marked ${updated.length} orphaned job(s) as failed on startup`,
        );
      } else {
        const counts = await this.dataSource.query(
          'SELECT status, COUNT(*)::int AS count FROM render_jobs GROUP BY status ORDER BY count DESC',
        );

        console.log('[render-jobs] Startup status counts:', counts);
      }
    } catch (err) {
      // Never fail app startup due to cleanup.

      console.warn(
        '[render-jobs] Failed to cleanup orphaned jobs on startup:',
        err instanceof Error ? err.message : err,
      );
    }
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

  private isSubscribeLikeSentence(text: string): boolean {
    return isSubscribeLikeSentence(text);
  }

  private useLambdaTestMode(): boolean {
    // Legacy name kept for backwards compatibility.
    return shouldUseRemotionLambda();
  }

  async createJob(params: {
    language?: string;
    audioFile: UploadedAsset | null;
    audioUrl?: string | null;
    allowSilentAudio?: boolean;
    sentences: SentenceInput[];
    imageFiles: Array<UploadedAsset | null>;
    textBackgroundVideoFiles: Array<UploadedAsset | null>;
    imageUrls?: Array<string | null> | null;
    scriptLength: string;
    audioDurationSeconds?: number;
    isShort?: boolean;
    useLowerFps?: boolean;
    useLowerResolution?: boolean;
    addSubtitles?: boolean;
    enableGlitchTransitions?: boolean;
    enableLongFormSubscribeOverlay?: boolean;
    backgroundMusicSrc?: string | null;
    backgroundMusicVolume?: number;
  }) {
    // if (this.isServerlessRuntime()) {
    //   throw new ServiceUnavailableException(
    //     'Video rendering requires persistent storage. Cloudinary video uploads are disabled, so rendering is not supported on serverless runtimes.',
    //   );
    // }

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

  async createUploadedVideoJob(params: { videoFile: UploadedAsset }) {
    if (this.isServerlessRuntime()) {
      throw new ServiceUnavailableException(
        'Uploading videos requires persistent storage. Cloudinary video uploads are disabled, so uploads are not supported on serverless runtimes.',
      );
    }

    const job = this.jobsRepo.create({
      status: 'queued',
      error: null,
      // audioPath is required by the DB schema; uploads don't have audio.
      audioPath: '',
      videoPath: null,
      timeline: null,
      lastProgressAt: new Date(),
    });
    await this.jobsRepo.save(job);

    try {
      const outputFsPath = this.getVideoFsPath(job.id);
      fs.writeFileSync(outputFsPath, params.videoFile.buffer);

      job.status = 'completed';
      job.videoPath = this.getPublicVideoUrl(job.id);
      job.lastProgressAt = new Date();
      await this.jobsRepo.save(job);
    } catch (err: any) {
      await this.jobsRepo.save({
        id: job.id,
        status: 'failed',
        error: err?.message || 'Failed to upload video',
      } as any);
    }

    return this.getJob(job.id);
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
    language?: string;
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
    addSubtitles?: boolean;
    enableGlitchTransitions?: boolean;
    enableLongFormSubscribeOverlay?: boolean;
    backgroundMusicSrc?: string | null;
    backgroundMusicVolume?: number;
    useRemoteAssets?: boolean;
    longFormSubscribeOverlaySrc?: string | null;
    longFormSubscribeOverlayDurationSeconds?: number | null;
  }) {
    return buildTimelineExternal(params);
  }

  private async getLongFormSubscribeOverlayDurationSeconds() {
    if (this.longFormSubscribeOverlayDurationSeconds !== null) {
      return this.longFormSubscribeOverlayDurationSeconds;
    }

    const assetPath = join(
      this.getRemotionPublicAssetsDir(),
      'subscribe_long_form.mp4',
    );

    try {
      const metadata = await getVideoMetadata(assetPath);
      const durationSeconds = Number(metadata.durationInSeconds);
      this.longFormSubscribeOverlayDurationSeconds =
        Number.isFinite(durationSeconds) && durationSeconds > 0
          ? durationSeconds
          : 6.36;
    } catch {
      this.longFormSubscribeOverlayDurationSeconds = 6.36;
    }

    return this.longFormSubscribeOverlayDurationSeconds;
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

  private safeCopyDirContents(srcDir: string, destDir: string) {
    safeCopyDirContentsExternal(srcDir, destDir);
  }

  private getRemotionPublicAssetsDir() {
    return join(process.cwd(), 'remotion', 'public');
  }

  private getPublicVideoUrl(jobId: string) {
    const fileName = `${jobId}.mp4`;
    return this.getPublicStorageUrl(`videos/${fileName}`);
  }

  private getPublicStorageUrl(relPath: string) {
    const baseUrl =
      process.env.REMOTION_ASSET_BASE_URL ??
      `http://127.0.0.1:${process.env.PORT ?? 3000}`;
    const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    return `${baseUrl}/static/${normalized}`;
  }

  private tryResolveLocalStaticFsPath(url: string): string | null {
    const trimmed = String(url ?? '').trim();
    if (!trimmed) return null;

    const baseUrl =
      process.env.REMOTION_ASSET_BASE_URL ??
      `http://127.0.0.1:${process.env.PORT ?? 3000}`;
    const normalizedBaseUrl = baseUrl.replace(/\/+$/u, '');

    let staticPath = '';
    if (trimmed.startsWith('/static/')) {
      staticPath = trimmed.slice('/static/'.length);
    } else if (trimmed.startsWith(`${normalizedBaseUrl}/static/`)) {
      staticPath = trimmed.slice(`${normalizedBaseUrl}/static/`.length);
    } else {
      return null;
    }

    const normalizedPath = staticPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalizedPath || normalizedPath.includes('..')) {
      return null;
    }

    return join(this.getStorageRoot(), normalizedPath);
  }

  private readLocalStaticFileToBuffer(url: string): {
    buffer: Buffer;
    fileName: string;
  } | null {
    const fsPath = this.tryResolveLocalStaticFsPath(url);
    if (!fsPath || !fs.existsSync(fsPath)) {
      return null;
    }

    return {
      buffer: fs.readFileSync(fsPath),
      fileName: fsPath.split(/[\\/]/u).pop() || 'audio.mp3',
    };
  }

  private getPublicAudioUrl(params: { jobId: string; ext: string }) {
    const safeExt = params.ext.startsWith('.') ? params.ext : `.${params.ext}`;
    return this.getPublicStorageUrl(
      `render-inputs/audio/${params.jobId}${safeExt}`,
    );
  }

  private getAudioFsPath(params: { jobId: string; ext: string }) {
    const root = this.getStorageRoot();
    const dir = join(root, 'render-inputs', 'audio');
    this.ensureDir(dir);
    const safeExt = params.ext.startsWith('.') ? params.ext : `.${params.ext}`;
    return join(dir, `${params.jobId}${safeExt}`);
  }

  getVideoFsPath(jobId: string) {
    const root = this.getStorageRoot();
    this.ensureDir(join(root, 'videos'));
    return join(root, 'videos', `${jobId}.mp4`);
  }

  private isLikelyVideoAsset(params: {
    mimeType?: string | null;
    originalName?: string | null;
    url?: string | null;
  }) {
    const mimeType = String(params.mimeType ?? '')
      .trim()
      .toLowerCase();
    if (mimeType.startsWith('video/')) return true;
    if (mimeType.startsWith('image/')) return false;

    const reference = `${String(params.originalName ?? '').trim()} ${String(
      params.url ?? '',
    ).trim()}`.toLowerCase();
    return /\.(mp4|mov|m4v|webm|avi|mkv|ogv|ogg)(?:\?|#|$)/u.test(reference);
  }

  async stageLocalRenderAsset(params: {
    file: UploadedAsset;
    kind: 'audio' | 'image' | 'video';
  }) {
    if (this.isServerlessRuntime()) {
      throw new ServiceUnavailableException(
        'Local render asset staging is not supported on serverless runtimes.',
      );
    }

    const root = this.getStorageRoot();
    const dir = join(root, 'render-inputs', 'staged', params.kind);
    this.ensureDir(dir);

    const ext = this.inferExt({
      originalName: params.file.originalName,
      mimeType: params.file.mimeType,
      fallback:
        params.kind === 'audio'
          ? '.mp3'
          : params.kind === 'video'
            ? '.mp4'
            : '.png',
    });

    const fileName = `${randomUUID()}${ext}`;
    fs.writeFileSync(join(dir, fileName), params.file.buffer);

    return {
      url: this.getPublicStorageUrl(
        `render-inputs/staged/${params.kind}/${fileName}`,
      ),
    };
  }

  private async renderWithRemotion(params: {
    jobId?: string;
    timeline: any;
    outputFsPath: string;
    publicDir: string;
    timeoutMs?: number;
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
      timeoutMs: params.timeoutMs,
    });
  }

  private prepareRemotionPublicDir(jobId: string) {
    const publicRoot = this.getRemotionPublicRootDir();
    const jobDir = join(publicRoot, jobId);
    this.ensureDir(jobDir);
    this.ensureDir(join(jobDir, 'images'));
    this.ensureDir(join(jobDir, 'audio'));
    this.ensureDir(join(jobDir, 'overlays'));
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
      language?: string;
      audioFile: UploadedAsset | null;
      audioUrl?: string | null;
      allowSilentAudio?: boolean;
      sentences: SentenceInput[];
      imageFiles: Array<UploadedAsset | null>;
      textBackgroundVideoFiles: Array<UploadedAsset | null>;
      imageUrls?: Array<string | null> | null;
      scriptLength: string;
      audioDurationSeconds?: number;
      isShort?: boolean;
      useLowerFps?: boolean;
      useLowerResolution?: boolean;
      addSubtitles?: boolean;
      enableGlitchTransitions?: boolean;
      enableLongFormSubscribeOverlay?: boolean;
      backgroundMusicSrc?: string | null;
      backgroundMusicVolume?: number;
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
      const normalizedAudioUrl = String(params.audioUrl ?? '').trim();
      const hasAudioUrl = normalizedAudioUrl.length > 0;
      const allowSilentAudio = params.allowSilentAudio === true;
      if (!hasAudioBuffer && !hasAudioUrl && !allowSilentAudio) {
        throw new Error('Missing voiceOver audio file');
      }

      let audioBuffer: Buffer | null = null;
      let audioName = 'audio.mp3';
      let audioMimeType: string | undefined;

      if (hasAudioBuffer && params.audioFile) {
        audioBuffer = params.audioFile.buffer;
        audioName = params.audioFile.originalName || 'audio.mp3';
        audioMimeType = params.audioFile.mimeType;

        // Persist voiceover audio locally so Lambda-mode can fetch it via public URL.
        // (Cloudinary uploads are disabled.)
        const ext = extname(audioName || '') || '.mp3';
        const audioFsPath = this.getAudioFsPath({ jobId, ext });
        fs.writeFileSync(audioFsPath, audioBuffer);
        job.audioPath = this.getPublicAudioUrl({ jobId, ext });
        await this.jobsRepo.save(job);
      } else if (hasAudioUrl) {
        const localAudio = this.readLocalStaticFileToBuffer(normalizedAudioUrl);
        if (localAudio) {
          audioBuffer = localAudio.buffer;
          audioName = localAudio.fileName;
        } else {
          const downloaded = await this.downloadUrlToBuffer({
            url: normalizedAudioUrl,
            maxBytes: 30 * 1024 * 1024,
            label: 'voiceOver audioUrl',
          });
          audioBuffer = downloaded.buffer;
          audioMimeType = downloaded.mimeType;
          audioName = 'audio.mp3';
        }

        // Use the provided URL directly (must be publicly accessible).
        // Cloudinary re-hosting is intentionally disabled.
        job.audioPath = normalizedAudioUrl;
        await this.jobsRepo.save(job);
      } else {
        job.audioPath = '';
        await this.jobsRepo.save(job);
      }

      // Create a temporary local audio file for alignment and audio analysis.
      // This is not persisted in project storage.
      const audioExt = extname(audioName || '') || '.mp3';
      const tempAudioPath = audioBuffer
        ? join(tempDir, `audio${audioExt}`)
        : null;
      if (tempAudioPath && audioBuffer) {
        fs.writeFileSync(tempAudioPath, audioBuffer);
      }

      const durationSeconds =
        params.audioDurationSeconds && params.audioDurationSeconds > 0
          ? params.audioDurationSeconds
          : this.estimateDurationSecondsForSilentRender(params.sentences);

      const useLambdaTestMode = this.useLambdaTestMode();
      const wantsLongFormSubscribeOverlay =
        params.enableLongFormSubscribeOverlay !== false &&
        !this.isShort(params.scriptLength);
      const longFormSubscribeOverlaySrc = wantsLongFormSubscribeOverlay
        ? REMOTION_SUBSCRIBE_LONG_FORM_VIDEO_REL
        : null;
      const longFormSubscribeOverlayDurationSeconds =
        wantsLongFormSubscribeOverlay
          ? await this.getLongFormSubscribeOverlayDurationSeconds()
          : null;

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

      const providedTextBackgroundVideoFiles = Array.isArray(
        params.textBackgroundVideoFiles,
      )
        ? params.textBackgroundVideoFiles
        : null;
      if (
        !providedTextBackgroundVideoFiles ||
        providedTextBackgroundVideoFiles.length !== params.sentences.length
      ) {
        throw new Error(
          'textBackgroundVideoFiles length must match sentences length',
        );
      }

      const stageSecondaryImageForSentence = async (
        index: number,
        localJobDir?: string,
      ) => {
        if (params.sentences[index]?.mediaType === 'text') return;

        const current = String(
          params.sentences[index]?.secondaryImageUrl ?? '',
        ).trim();
        if (!current) return;

        if (useLambdaTestMode) {
          if (this.isCloudinaryUrl(current)) return;

          const downloaded = await this.downloadUrlToBuffer({
            url: current,
            maxBytes: 12 * 1024 * 1024,
            label: `secondary image for sentence ${index + 1}`,
          });

          const uploaded = await this.uploadBufferToCloudinary({
            buffer: downloaded.buffer,
            folder: 'auto-video-generator/render-inputs/images',
            resource_type: 'image',
          });

          params.sentences[index].secondaryImageUrl = uploaded.secure_url;
          return;
        }

        const downloaded = await this.downloadUrlToBuffer({
          url: current,
          maxBytes: 12 * 1024 * 1024,
          label: `secondary image for sentence ${index + 1}`,
        });

        const ext = this.inferExt({
          originalName: current,
          mimeType: downloaded.mimeType,
          fallback: '.png',
        });

        const rel = `images/scene-${String(index + 1).padStart(3, '0')}-secondary${ext}`;
        if (!localJobDir) {
          throw new Error(
            'Missing local job directory for staging secondary images',
          );
        }

        fs.writeFileSync(join(localJobDir, rel), downloaded.buffer);
        params.sentences[index].secondaryImageUrl = rel;
      };

      const stageTextBackgroundVideoForSentence = async (
        index: number,
        localJobDir?: string,
      ) => {
        const sentence = params.sentences[index];
        if (sentence?.mediaType !== 'text') return;

        const backgroundMode = resolveTextSceneBackgroundMode(
          sentence.textAnimationSettings,
        );
        if (backgroundMode !== 'inheritVideo' && backgroundMode !== 'video') {
          return;
        }

        const current = String(sentence.textBackgroundVideoUrl ?? '').trim();
        const uploadedFile = providedTextBackgroundVideoFiles[index];
        const rel = `videos/scene-${String(index + 1).padStart(3, '0')}-text-background`;

        if (useLambdaTestMode) {
          if (current) return;

          if (!uploadedFile?.buffer) {
            throw new Error(
              `Missing text background video for text scene ${index + 1}.`,
            );
          }

          const uploaded = await this.uploadBufferToCloudinary({
            buffer: uploadedFile.buffer,
            folder: 'auto-video-generator/render-inputs/videos',
            resource_type: 'video',
          });

          params.sentences[index].textBackgroundVideoUrl = uploaded.secure_url;
          return;
        }

        if (!localJobDir) {
          throw new Error(
            'Missing local job directory for staging text background videos',
          );
        }

        if (current) {
          const localStatic = this.readLocalStaticFileToBuffer(current);
          const downloaded =
            localStatic ??
            (await this.downloadUrlToBuffer({
              url: current,
              maxBytes: 100 * 1024 * 1024,
              label: `text background video for sentence ${index + 1}`,
            }));

          const ext = this.inferExt({
            originalName: localStatic?.fileName ?? current,
            mimeType:
              'mimeType' in downloaded ? downloaded.mimeType : undefined,
            fallback: '.mp4',
          });

          const stagedRel = `${rel}${ext}`;
          fs.writeFileSync(join(localJobDir, stagedRel), downloaded.buffer);
          params.sentences[index].textBackgroundVideoUrl = stagedRel;
          return;
        }

        if (!uploadedFile?.buffer) {
          throw new Error(
            `Missing text background video for text scene ${index + 1}.`,
          );
        }

        const ext = this.inferExt({
          originalName: uploadedFile.originalName,
          mimeType: uploadedFile.mimeType,
          fallback: '.mp4',
        });

        const stagedRel = `${rel}${ext}`;
        fs.writeFileSync(join(localJobDir, stagedRel), uploadedFile.buffer);
        params.sentences[index].textBackgroundVideoUrl = stagedRel;
      };

      const stageOverlayAssetForSentence = async (
        index: number,
        localJobDir?: string,
      ) => {
        const sentence = params.sentences[index];
        if (sentence?.mediaType !== 'overlay') return;

        const current = String(sentence.overlayUrl ?? '').trim();
        if (!current) {
          throw new Error(`Missing overlay asset for scene ${index + 1}.`);
        }

        const overlayMimeType =
          String(sentence.overlayMimeType ?? '').trim() || undefined;

        if (useLambdaTestMode) {
          if (this.isCloudinaryUrl(current)) return;

          const localStatic = this.readLocalStaticFileToBuffer(current);
          const downloaded =
            localStatic ??
            (await this.downloadUrlToBuffer({
              url: current,
              maxBytes: 100 * 1024 * 1024,
              label: `overlay asset for sentence ${index + 1}`,
            }));

          const mimeType =
            overlayMimeType ??
            ('mimeType' in downloaded ? downloaded.mimeType : undefined);
          const resourceType = this.isLikelyVideoAsset({
            mimeType,
            originalName: localStatic?.fileName ?? current,
            url: current,
          })
            ? 'video'
            : 'image';

          const uploaded = await this.uploadBufferToCloudinary({
            buffer: downloaded.buffer,
            folder: `auto-video-generator/render-inputs/${resourceType === 'video' ? 'videos' : 'images'}`,
            resource_type: resourceType,
          });

          params.sentences[index].overlayUrl = uploaded.secure_url;
          if (!params.sentences[index].overlayMimeType && mimeType) {
            params.sentences[index].overlayMimeType = mimeType;
          }
          return;
        }

        if (!localJobDir) {
          throw new Error(
            'Missing local job directory for staging overlay assets',
          );
        }

        const localStatic = this.readLocalStaticFileToBuffer(current);
        const downloaded =
          localStatic ??
          (await this.downloadUrlToBuffer({
            url: current,
            maxBytes: 100 * 1024 * 1024,
            label: `overlay asset for sentence ${index + 1}`,
          }));

        const mimeType =
          overlayMimeType ??
          ('mimeType' in downloaded ? downloaded.mimeType : undefined);
        const isVideo = this.isLikelyVideoAsset({
          mimeType,
          originalName: localStatic?.fileName ?? current,
          url: current,
        });
        const ext = this.inferExt({
          originalName: localStatic?.fileName ?? current,
          mimeType,
          fallback: isVideo ? '.mp4' : '.png',
        });

        const stagedRel = `overlays/scene-${String(index + 1).padStart(3, '0')}-overlay${ext}`;
        fs.writeFileSync(join(localJobDir, stagedRel), downloaded.buffer);
        params.sentences[index].overlayUrl = stagedRel;
        if (!params.sentences[index].overlayMimeType && mimeType) {
          params.sentences[index].overlayMimeType = mimeType;
        }
      };

      const hasSubscribeSentence = params.sentences.some((s) =>
        this.isSubscribeLikeSentence(s?.text || ''),
      );

      if (useLambdaTestMode) {
        if (job.audioPath) {
          voiceoverAudioSrc = job.audioPath;
        }

        subscribeVideoSrc = hasSubscribeSentence
          ? SUBSCRIBE_VIDEO_CLOUDINARY_URL
          : null;

        for (let i = 0; i < params.sentences.length; i += 1) {
          const sentenceText = (params.sentences[i]?.text || '').trim();
          const isSubscribe = this.isSubscribeLikeSentence(sentenceText);
          if (isSubscribe) {
            imageSrcs.push('');
            continue;
          }

          await stageOverlayAssetForSentence(i);
          await stageTextBackgroundVideoForSentence(i);

          if (!sentenceUsesPrimaryImageTransport(params.sentences[i])) {
            imageSrcs.push('');
            continue;
          }

          await stageSecondaryImageForSentence(i);

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
            throw new Error(`Missing image upload for scene ${i + 1}.`);
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
        const remotionAssetsDir = this.getRemotionPublicAssetsDir();
        this.safeCopyDirContents(remotionAssetsDir, jobDir);
        // Prefer local assets in local rendering (avoids network/proxy failures).
        // If copying the subscribe clip fails on Windows (rare EPERM cases), fall back to CDN.
        subscribeVideoSrc = hasSubscribeSentence
          ? prepared.subscribeVideoSrc
          : null;
        publicDirToClean = jobDir;

        // Materialize required Remotion assets into the job-scoped publicDir.
        if (audioBuffer) {
          fs.writeFileSync(join(jobDir, REMOTION_VOICEOVER_REL), audioBuffer);
        }
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
          join(remotionAssetsDir, 'whoosh-end.mp3'),
          join(jobDir, REMOTION_CHROMA_LEAK_SFX_REL),
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
          try {
            this.safeCopyFile(
              join(remotionAssetsDir, 'subscribe.mp4'),
              join(jobDir, REMOTION_SUBSCRIBE_VIDEO_REL),
            );
            subscribeVideoSrc = prepared.subscribeVideoSrc;
          } catch {
            // If local copying fails (rare Windows file locking), avoid falling back
            // to a remote URL because that can fail in restricted/offline environments.
            subscribeVideoSrc = null;
          }
        }

        if (wantsLongFormSubscribeOverlay) {
          this.safeCopyFile(
            join(remotionAssetsDir, 'subscribe_long_form.mp4'),
            join(jobDir, REMOTION_SUBSCRIBE_LONG_FORM_VIDEO_REL),
          );
        }

        // If a custom background soundtrack URL was provided, download it into the job-scoped
        // Remotion publicDir so rendering does not depend on network access/timeouts.
        // (Remotion renderer downloads remote media during render and can time out; pre-downloading
        // keeps renders stable on Windows and in restricted networks.)
        let effectiveBackgroundMusicSrc: string | null | undefined =
          params.backgroundMusicSrc;
        if (
          typeof params.backgroundMusicSrc === 'string' &&
          /^https?:\/\//i.test(params.backgroundMusicSrc.trim())
        ) {
          const url = params.backgroundMusicSrc.trim();
          try {
            const downloaded = await this.downloadUrlToBuffer({
              url,
              maxBytes: 25 * 1024 * 1024,
              label: 'background music',
            });

            const mime = String(downloaded.mimeType ?? '').toLowerCase();
            const extFromMime = () => {
              if (mime.includes('audio/mpeg') || mime.includes('audio/mp3'))
                return '.mp3';
              if (mime.includes('audio/wav')) return '.wav';
              if (mime.includes('audio/aac')) return '.aac';
              if (mime.includes('audio/ogg')) return '.ogg';
              if (mime.includes('audio/mp4') || mime.includes('audio/x-m4a'))
                return '.m4a';
              return '';
            };

            const ext =
              extFromMime() ||
              extname(url.split('?')[0] || '').toLowerCase() ||
              '.mp3';

            const rel = `audio/background_custom${ext}`;
            this.ensureDir(join(jobDir, 'audio'));
            fs.writeFileSync(join(jobDir, rel), downloaded.buffer);
            effectiveBackgroundMusicSrc = rel;
          } catch {
            // If the custom URL can't be reached (DNS/firewall/offline), don't fail the render.
            // Fall back to the composition's local default background track.
            effectiveBackgroundMusicSrc = undefined;
          }
        }

        // Reassign so the timeline uses the local asset path.
        params.backgroundMusicSrc = effectiveBackgroundMusicSrc;

        voiceoverAudioSrc = audioBuffer ? REMOTION_VOICEOVER_REL : '';

        // Pre-download per-sentence sound effects into the job-scoped publicDir.
        // This keeps renders stable (no runtime network fetches) and ensures audio can be
        // fetched locally by Remotion.
        const sfxCache = new Map<string, string>();
        const sfxDirRel = 'audio/sentence-sfx';
        this.ensureDir(join(jobDir, 'audio'));
        this.ensureDir(join(jobDir, sfxDirRel));

        const stageSfx = async (src: string, label: string) => {
          const trimmed = String(src ?? '').trim();
          if (!trimmed) return '';
          if (!/^https?:\/\//i.test(trimmed)) return trimmed;
          const cached = sfxCache.get(trimmed);
          if (cached) return cached;

          try {
            const downloaded = await this.downloadUrlToBuffer({
              url: trimmed,
              maxBytes: 25 * 1024 * 1024,
              label,
            });

            const ext = this.inferExt({
              originalName: trimmed,
              mimeType: downloaded.mimeType,
              fallback: '.mp3',
            });

            const hash = createHash('sha1')
              .update(trimmed)
              .digest('hex')
              .slice(0, 10);
            const rel = `${sfxDirRel}/sfx-${hash}${ext}`;
            fs.writeFileSync(join(jobDir, rel), downloaded.buffer);
            sfxCache.set(trimmed, rel);
            return rel;
          } catch {
            // If download fails (DNS/firewall/offline), keep the remote URL.
            return trimmed;
          }
        };

        for (let i = 0; i < params.sentences.length; i += 1) {
          const soundEffects = (params.sentences[i] as any)?.soundEffects;
          if (!Array.isArray(soundEffects) || soundEffects.length === 0)
            continue;

          for (let j = 0; j < soundEffects.length; j += 1) {
            const se = soundEffects[j];
            const src = String(se?.src ?? '').trim();
            if (!src) continue;
            const staged = await stageSfx(
              src,
              `sentence ${i + 1} sound effect ${j + 1}`,
            );
            se.src = staged;
          }
        }

        for (let i = 0; i < params.sentences.length; i += 1) {
          const sentenceText = (params.sentences[i]?.text || '').trim();
          const isSubscribe = this.isSubscribeLikeSentence(sentenceText);
          if (isSubscribe) {
            imageSrcs.push('');
            continue;
          }

          await stageOverlayAssetForSentence(i, jobDir);
          await stageTextBackgroundVideoForSentence(i, jobDir);

          if (!sentenceUsesPrimaryImageTransport(params.sentences[i])) {
            imageSrcs.push('');
            continue;
          }

          await stageSecondaryImageForSentence(i, jobDir);

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
            throw new Error(`Missing image upload for scene ${i + 1}.`);
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
      const sentenceTimings = tempAudioPath
        ? await this.alignAudioToSentences(
            tempAudioPath,
            params.sentences,
            durationSeconds,
          )
        : this.buildSyntheticSentenceTimings(params.sentences, durationSeconds);

      const timeline = this.buildTimeline({
        language: params.language,
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
        addSubtitles: params.addSubtitles,
        enableGlitchTransitions: params.enableGlitchTransitions,
        enableLongFormSubscribeOverlay: params.enableLongFormSubscribeOverlay,
        backgroundMusicSrc: params.backgroundMusicSrc,
        backgroundMusicVolume: params.backgroundMusicVolume,
        longFormSubscribeOverlaySrc,
        longFormSubscribeOverlayDurationSeconds,
        useRemoteAssets: useLambdaTestMode,
      });

      job.timeline = timeline;
      job.status = 'rendering';
      job.lastProgressAt = new Date();
      await this.jobsRepo.save(job);

      const outputFsPath = this.getVideoFsPath(jobId);
      const renderTimeoutMs = resolveRemotionRenderTimeoutMs(timeline);
      await this.withTimeout(
        this.renderWithRemotion({
          jobId,
          timeline,
          outputFsPath,
          publicDir,
          timeoutMs: renderTimeoutMs,
        }),
        renderTimeoutMs,
        'Remotion render',
      );

      // Cloudinary uploads are disabled; keep the MP4 on disk and serve via /static.
      const videoUrl = this.getPublicVideoUrl(jobId);

      job.status = 'completed';
      job.videoPath = videoUrl;
      await this.jobsRepo.save(job);
    } catch (err: any) {
      const stack = typeof err?.stack === 'string' ? err.stack : '';
      const message = typeof err?.message === 'string' ? err.message : '';
      const combined = (
        stack ||
        message ||
        'Failed to process render job'
      ).trim();
      // Keep DB payload bounded.
      const bounded =
        combined.length > 4000 ? `${combined.slice(0, 4000)}…` : combined;
      await this.jobsRepo.save({
        id: jobId,
        status: 'failed',
        error: bounded,
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

  private estimateDurationSecondsForSilentRender(
    sentences: SentenceInput[],
  ): number {
    const wordCount = sentences.reduce((total, sentence) => {
      const words = String(sentence?.text ?? '')
        .trim()
        .split(/\s+/u)
        .filter(Boolean).length;
      return total + words;
    }, 0);

    const estimated = wordCount > 0 ? wordCount / 2.6 : sentences.length * 2.4;
    return Math.max(sentences.length * 1.5, Math.min(estimated, 90), 1);
  }

  private buildSyntheticSentenceTimings(
    sentences: SentenceInput[],
    audioDurationSeconds: number,
  ): SentenceTiming[] {
    const buildSyntheticWords = (
      text: string,
      startSeconds: number,
      endSeconds: number,
    ) => {
      const words = String(text ?? '')
        .trim()
        .split(/\s+/u)
        .filter(Boolean);

      if (words.length === 0) return [];

      const span = Math.max(0.1, endSeconds - startSeconds);
      return words.map((word, index) => ({
        text: word,
        startSeconds: startSeconds + (span * index) / words.length,
        endSeconds: Math.max(
          startSeconds + (span * index) / words.length + 0.01,
          startSeconds + (span * (index + 1)) / words.length,
        ),
      }));
    };

    const totalDuration = Math.max(1, audioDurationSeconds || 1);
    const weights = sentences.map((sentence) => {
      const words = String(sentence?.text ?? '')
        .trim()
        .split(/\s+/u)
        .filter(Boolean).length;
      return Math.max(1, words);
    });
    const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;

    let cursor = 0;
    return sentences.map((sentence, index) => {
      const slice = (weights[index] / totalWeight) * totalDuration;
      const startSeconds = cursor;
      const endSeconds =
        index === sentences.length - 1
          ? totalDuration
          : Math.min(totalDuration, startSeconds + slice);
      cursor = endSeconds;

      return {
        index,
        text: String(sentence?.text ?? ''),
        startSeconds,
        endSeconds: Math.max(startSeconds + 0.2, endSeconds),
        words: buildSyntheticWords(
          String(sentence?.text ?? ''),
          startSeconds,
          Math.max(startSeconds + 0.2, endSeconds),
        ),
      };
    });
  }
}
