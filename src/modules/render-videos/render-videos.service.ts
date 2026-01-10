import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RenderJob } from './entities/render-job.entity';
import { join, extname } from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { v2 as cloudinary } from 'cloudinary';
import OpenAI from 'openai';

type SentenceInput = { text: string };

type UploadedAsset = {
  buffer: Buffer;
  originalName: string;
  mimeType?: string;
};

type UrlAsset = {
  url: string;
};

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

  private static remotionServeUrlPromise: Promise<string> | null = null;
  private static remotionServeUrl: string | null = null;
  private static remotionServeUrlPublicDir: string | null = null;

  constructor(
    @InjectRepository(RenderJob)
    private readonly jobsRepo: Repository<RenderJob>,
  ) {
    const apiKey = process.env.OPENAI_API_KEY;
    this.openai = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async createJob(params: {
    audioFile: UploadedAsset | null;
    audioUrl?: string | null;
    sentences: SentenceInput[];
    imageFiles: Array<UploadedAsset | null>;
    imageUrls?: Array<string | null> | null;
    scriptLength: string;
    audioDurationSeconds?: number;
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
    return scriptLength.trim().toLowerCase().startsWith('30');
  }

  private async downloadUrlToBuffer(params: {
    url: string;
    maxBytes: number;
    label: string;
  }): Promise<{ buffer: Buffer; mimeType?: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(params.url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(
          `Failed to download ${params.label} (${res.status}): ${res.statusText}`,
        );
      }

      const contentLength = res.headers.get('content-length');
      if (contentLength) {
        const bytes = Number(contentLength);
        if (Number.isFinite(bytes) && bytes > params.maxBytes) {
          throw new Error(
            `Downloaded ${params.label} is too large (${bytes} bytes)`,
          );
        }
      }

      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength > params.maxBytes) {
        throw new Error(
          `Downloaded ${params.label} is too large (${arrayBuffer.byteLength} bytes)`,
        );
      }

      const mimeType = res.headers.get('content-type') ?? undefined;
      return { buffer: Buffer.from(arrayBuffer), mimeType };
    } finally {
      clearTimeout(timeout);
    }
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
        imageSrc: isSubscribe ? undefined : params.imagePaths[index],
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
    return (
      !!process.env.VERCEL ||
      !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
      !!process.env.LAMBDA_TASK_ROOT ||
      (process.env.AWS_EXECUTION_ENV ?? '').toLowerCase().includes('lambda')
    );
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
    const staleMinutesRaw = Number(process.env.RENDER_JOB_STALE_MINUTES ?? '45');
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
    fs.mkdirSync(dir, { recursive: true });
  }

  private inferExt(params: {
    originalName?: string;
    mimeType?: string;
    fallback: string;
  }) {
    const fromName = params.originalName ? extname(params.originalName) : '';
    if (fromName) return fromName;

    const mt = (params.mimeType ?? '').toLowerCase();
    if (mt.includes('png')) return '.png';
    if (mt.includes('jpeg') || mt.includes('jpg')) return '.jpg';
    if (mt.includes('webp')) return '.webp';
    if (mt.includes('gif')) return '.gif';
    if (mt.includes('mp3')) return '.mp3';
    if (mt.includes('wav')) return '.wav';
    if (mt.includes('mpeg')) return '.mp3';
    return params.fallback;
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
    let timeoutId: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${label} timed out after ${ms}ms`));
      }, ms);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private ensureCloudinaryConfigured() {
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_CLOUD_SECRET
    ) {
      throw new Error('Cloudinary environment variables are not configured');
    }

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_CLOUD_SECRET,
    });
  }

  private async uploadBufferToCloudinary(params: {
    buffer: Buffer;
    folder: string;
    resource_type: 'image' | 'video';
  }): Promise<{ secure_url: string; public_id: string }> {
    this.ensureCloudinaryConfigured();

    const uploadPromise = new Promise<any>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: params.folder,
          resource_type: params.resource_type,
          overwrite: false,
          use_filename: false,
        },
        (error, result) => {
          if (error || !result) {
            return reject(error ?? new Error('Cloudinary upload failed'));
          }
          resolve(result);
        },
      );

      stream.end(params.buffer);
    });

    const uploadResult: any = await this.withTimeout(
      uploadPromise,
      params.resource_type === 'image' ? 60_000 : 90_000,
      `Cloudinary ${params.resource_type} upload`,
    );

    if (!uploadResult?.secure_url || !uploadResult?.public_id) {
      throw new Error('Cloudinary upload did not return a secure_url');
    }

    return {
      secure_url: uploadResult.secure_url as string,
      public_id: uploadResult.public_id as string,
    };
  }

  private async uploadVideoFileToCloudinary(params: {
    filePath: string;
    folder: string;
  }): Promise<{ secure_url: string; public_id?: string }> {
    this.ensureCloudinaryConfigured();

    const stat = fs.statSync(params.filePath);
    const bytes = stat.size;

    // Cloudinary requires chunked uploads for larger video files.
    // Using upload_large avoids 413 "Request Entity Too Large" for big MP4s.
    const useChunked = bytes >= 90 * 1024 * 1024;

    const uploadPromise = new Promise<any>((resolve, reject) => {
      const cb = (error: any, result: any) => {
        if (error || !result) return reject(error ?? new Error('Cloudinary upload failed'));
        resolve(result);
      };

      const options: any = {
        folder: params.folder,
        resource_type: 'video',
        overwrite: false,
        use_filename: false,
      };

      if (useChunked) {
        cloudinary.uploader.upload_large(
          params.filePath,
          {
            ...options,
            chunk_size: 20 * 1024 * 1024,
          },
          cb,
        );
      } else {
        cloudinary.uploader.upload(params.filePath, options, cb);
      }
    });

    const uploadResult: any = await this.withTimeout(
      uploadPromise,
      30 * 60_000,
      'Cloudinary final video upload',
    );

    if (!uploadResult?.secure_url) {
      throw new Error('Cloudinary video upload did not return a secure_url');
    }

    return {
      secure_url: uploadResult.secure_url as string,
      public_id: uploadResult.public_id as string | undefined,
    };
  }

  private createTempDir(prefix: string) {
    return fs.mkdtempSync(join(os.tmpdir(), prefix));
  }

  private safeRmDir(dir: string) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
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

    const concurrencyRaw = Number(process.env.REMOTION_CONCURRENCY ?? '');
    const defaultConcurrency = Math.min(2, Math.max(1, os.cpus().length));
    const concurrency = Number.isFinite(concurrencyRaw) && concurrencyRaw > 0
      ? Math.max(1, Math.floor(concurrencyRaw))
      : defaultConcurrency;

    const chromiumOptions: any = {
      // Helpful on constrained Linux environments.
      disableWebSecurity: true,
      // Remotion will pass these through to Chromium.
      // Keep it minimal to reduce surprises.
      // If you still hit crashes, consider setting:
      // REMOTION_CHROMIUM_DISABLE_SANDBOX=true
    };

    if (process.env.REMOTION_CHROMIUM_DISABLE_SANDBOX === 'true') {
      chromiumOptions.disableSandbox = true;
    }

    const serveUrl = await this.getOrCreateRemotionServeUrl({
      bundler,
      entryPoint,
      publicDir: params.publicDir,
    });

    const compositions = await renderer.getCompositions(serveUrl, {
      inputProps: { timeline: params.timeline },
      chromiumOptions,
    });
    const composition = compositions.find((c: any) => c.id === 'AutoVideo') ?? {
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
      chromiumOptions,
      concurrency,
    });
  }

  private async getOrCreateRemotionServeUrl(params: {
    bundler: any;
    entryPoint: string;
    publicDir: string;
  }) {
    if (
      RenderVideosService.remotionServeUrl &&
      RenderVideosService.remotionServeUrlPublicDir === params.publicDir
    ) {
      return RenderVideosService.remotionServeUrl;
    }

    if (
      RenderVideosService.remotionServeUrlPromise &&
      RenderVideosService.remotionServeUrlPublicDir === params.publicDir
    ) {
      return RenderVideosService.remotionServeUrlPromise;
    }

    RenderVideosService.remotionServeUrlPublicDir = params.publicDir;
    RenderVideosService.remotionServeUrlPromise = params.bundler
      .bundle({
        entryPoint: params.entryPoint,
        publicDir: params.publicDir,
      })
      .then((url: string) => {
        RenderVideosService.remotionServeUrl = url;
        return url;
      })
      .finally(() => {
        RenderVideosService.remotionServeUrlPromise = null;
      });

    return RenderVideosService.remotionServeUrlPromise;
  }

  private prepareRemotionPublicDir(jobId: string) {
    const publicRoot = this.getRemotionPublicRootDir();
    const jobDir = join(publicRoot, jobId);
    this.ensureDir(jobDir);
    this.ensureDir(join(jobDir, 'images'));

    // Try to copy the subscribe.mp4 video and background.mp3 audio
    // from known public folders into this job's public directory.
    let subscribeVideoSrc: string | null = null;
    try {
      const videoSources = [
        // Preferred: backend Remotion public folder
        join(process.cwd(), 'remotion', 'public', 'subscribe.mp4'),
        // Legacy: frontend public folder
        join(
          process.cwd(),
          '..',
          'auto-video-frontend',
          'public',
          'subscribe.mp4',
        ),
      ];

      for (const source of videoSources) {
        if (fs.existsSync(source)) {
          const dest = join(jobDir, 'subscribe.mp4');
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
        join(
          process.cwd(),
          '..',
          'auto-video-frontend',
          'public',
          'background.mp3',
        ),
      ];

      for (const source of bgSources) {
        if (fs.existsSync(source)) {
          const dest = join(jobDir, 'background.mp3');
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
        join(
          process.cwd(),
          '..',
          'auto-video-frontend',
          'public',
          'glitch-fx.mp3',
        ),
      ];

      for (const source of glitchSources) {
        if (fs.existsSync(source)) {
          const dest = join(jobDir, 'glitch-fx.mp3');
          fs.copyFileSync(source, dest);
          break;
        }
      }
    } catch {
      // Glitch sound effect is optional; ignore copy errors.
    }

    try {
      const whooshSources = [
        join(process.cwd(), 'remotion', 'public', 'whoosh.mp3'),
        join(
          process.cwd(),
          '..',
          'auto-video-frontend',
          'public',
          'whoosh.mp3',
        ),
      ];

      for (const source of whooshSources) {
        if (fs.existsSync(source)) {
          const dest = join(jobDir, 'whoosh.mp3');
          fs.copyFileSync(source, dest);
          break;
        }
      }
    } catch {
      // Whoosh sound effect is optional; ignore copy errors.
    }

    try {
      const cameraClickSources = [
        join(process.cwd(), 'remotion', 'public', 'camera_click.mp3'),
        join(
          process.cwd(),
          '..',
          'auto-video-frontend',
          'public',
          'camera_click.mp3',
        ),
      ];

      for (const source of cameraClickSources) {
        if (fs.existsSync(source)) {
          const dest = join(jobDir, 'camera_click.mp3');
          fs.copyFileSync(source, dest);
          break;
        }
      }
    } catch {
      // Camera click sound effect is optional; ignore copy errors.
    }

    return {
      // Use a job-scoped publicDir so Remotion bundling includes the job's assets.
      publicDir: jobDir,
      jobDir,
      subscribeVideoSrc,
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
        // audioUrl should already point to a public URL (ideally Cloudinary).
        job.audioPath = String(params.audioUrl);
        await this.jobsRepo.save(job);

        const downloaded = await this.downloadUrlToBuffer({
          url: String(params.audioUrl),
          maxBytes: 30 * 1024 * 1024,
          label: 'voiceOver audioUrl',
        });
        audioBuffer = downloaded.buffer;
        audioMimeType = downloaded.mimeType;
        audioName = 'audio.mp3';
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

      const { publicDir, jobDir, subscribeVideoSrc } =
        this.prepareRemotionPublicDir(jobId);
      publicDirToClean = jobDir;

      // Place audio into the Remotion publicDir so rendering does not rely on
      // remote audio URLs (prevents CORS/network stalls in Chromium).
      const publicAudioName = `audio${audioExt}`;
      fs.writeFileSync(join(jobDir, publicAudioName), audioBuffer);

      // Build per-sentence image sources.
      // Store images locally under jobDir so Remotion can load via staticFile() without
      // per-image Cloudinary uploads or Chromium doing many remote fetches during render.
      const imageSrcs: string[] = [];
      const providedUrls = Array.isArray(params.imageUrls)
        ? params.imageUrls
        : null;

      if (providedUrls && providedUrls.length !== params.sentences.length) {
        throw new Error('imageUrls length must match sentences length');
      }

      const imagesDir = join(jobDir, 'images');
      for (let i = 0; i < params.sentences.length; i += 1) {
        const sentenceText = (params.sentences[i]?.text || '').trim();
        const isSubscribe = sentenceText === SUBSCRIBE_SENTENCE;
        if (isSubscribe) {
          imageSrcs.push('');
          continue;
        }

        const url = providedUrls ? providedUrls[i] : null;
        if (url) {
          try {
            const downloaded = await this.downloadUrlToBuffer({
              url: String(url),
              maxBytes: 12 * 1024 * 1024,
              label: `imageUrl for sentence ${i + 1}`,
            });
            const ext = this.inferExt({
              mimeType: downloaded.mimeType,
              fallback: '.png',
            });
            const fileName = `img-${i + 1}${ext}`;
            fs.writeFileSync(join(imagesDir, fileName), downloaded.buffer);
            imageSrcs.push(`images/${fileName}`);
          } catch {
            // If the download fails, fall back to the remote URL.
            imageSrcs.push(String(url));
          }
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
        const fileName = `img-${i + 1}${ext}`;
        fs.writeFileSync(join(imagesDir, fileName), file.buffer);
        imageSrcs.push(`images/${fileName}`);
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
        audioSrc: publicAudioName,
        sentenceTimings,
        subscribeVideoSrc,
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
        this.renderWithRemotion({ timeline, outputFsPath, publicDir }),
        20 * 60_000,
        'Remotion render',
      );

      // Upload the rendered video to Cloudinary.
      // If it fails (often due to 413 on large files), fall back to serving the local file.
      let finalUrl: string | null = null;
      try {
        const uploaded = await this.uploadVideoFileToCloudinary({
          filePath: outputFsPath,
          folder: 'auto-video-generator/videos',
        });
        finalUrl = uploaded.secure_url;

        // If upload succeeded, clean up local output.
        try {
          fs.unlinkSync(outputFsPath);
        } catch {
          // ignore
        }
      } catch (uploadErr: any) {
        // Keep local output and serve it via /static/videos.
        console.warn('[RenderVideosService] Cloudinary upload failed; using local video URL', {
          jobId,
          message: uploadErr?.message,
        });
        finalUrl = this.getPublicVideoUrl(jobId);
      }

      job.status = 'completed';
      job.videoPath = finalUrl;
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
    const fallback = () =>
      this.alignByVoiceActivity(audioPath, sentences, audioDurationSeconds);

    // Debug logging to inspect whether OpenAI-based alignment is used.

    console.log('[RenderVideosService] alignAudioToSentences called', {
      audioPath,
      audioDurationSeconds,
      sentenceCount: sentences.length,
      hasOpenAI: !!this.openai,
    });

    if (!this.openai) {
      console.log(
        '[RenderVideosService] OpenAI client not configured, using fallback alignment',
      );
      return fallback();
    }

    if (!fs.existsSync(audioPath)) {
      console.warn('[RenderVideosService] Audio file not found for alignment', {
        audioPath,
      });
      return fallback();
    }

    try {
      const model = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe';
      // Newer GPT-4o-based transcription models only support 'json' or 'text'.
      const responseFormat = model.startsWith('gpt-4o')
        ? 'json'
        : 'verbose_json';

      console.log(
        '[RenderVideosService] Calling OpenAI audio.transcriptions.create',
        {
          model,
          responseFormat,
        },
      );

      const transcription: any = await this.withTimeout(
        this.openai.audio.transcriptions.create({
          file: fs.createReadStream(audioPath),
          model,
          response_format: responseFormat as any,
        } as any),
        Number(process.env.OPENAI_TRANSCRIBE_TIMEOUT_MS ?? '120000'),
        'OpenAI transcription',
      );

      let segments: any[] = Array.isArray(transcription?.segments)
        ? transcription.segments
        : [];

      console.log('[RenderVideosService] OpenAI transcription result', {
        hasSegments: Array.isArray(transcription?.segments),
        segmentCount: segments.length,
      });

      if (!segments.length) {
        // If the chosen model (e.g. gpt-4o-transcribe) does not return
        // word-level segments, fall back to Whisper, which does.
        const whisperModel = 'whisper-1';

        console.warn(
          '[RenderVideosService] Primary transcription model returned no segments; retrying with Whisper',
          { primaryModel: model, whisperModel },
        );

        const whisperTranscription: any = await this.withTimeout(
          this.openai.audio.transcriptions.create({
            file: fs.createReadStream(audioPath),
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
          console.warn(
            '[RenderVideosService] Whisper also returned no segments, using fallback alignment',
          );
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
        const segStartRaw = seg.start;
        const segEndRaw = seg.end;
        const segStart =
          typeof segStartRaw === 'number'
            ? segStartRaw
            : parseFloat(segStartRaw);
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
          if (!token) {
            continue;
          }
          wordsTimeline.push({ token, startSeconds: wStart, endSeconds: wEnd });
        }
      }

      if (!wordsTimeline.length) {
        console.warn(
          '[RenderVideosService] No wordsTimeline built from transcription, using fallback alignment',
        );
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
          const prevEnd = i > 0 ? timings[i - 1].endSeconds : 0;
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
          const prevEnd = i > 0 ? timings[i - 1].endSeconds : 0;
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
          const prevEnd = timings.length
            ? timings[timings.length - 1].endSeconds
            : 0;
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

      console.log(
        '[RenderVideosService] OpenAI-based alignment produced timings',
        {
          timingCount: timings.length,
        },
      );

      return timings;
    } catch (err) {
      console.error(
        '[RenderVideosService] Error during OpenAI alignment, using fallback',
        {
          message: err?.message,
        },
      );
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
        .filter(
          (p) =>
            Number.isFinite(p.start) &&
            Number.isFinite(p.end) &&
            p.end > p.start,
        )
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
        };
      });

      const realDuration =
        Number(result?.durationInSeconds) || audioDurationSeconds || 1;
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
        t.endSeconds = Math.max(
          t.startSeconds + 0.05,
          Math.min(t.endSeconds, T),
        );
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
