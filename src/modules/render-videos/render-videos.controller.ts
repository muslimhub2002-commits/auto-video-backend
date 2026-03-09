import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  ServiceUnavailableException,
  MethodNotAllowedException,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {
  FileFieldsInterceptor,
  FileInterceptor,
} from '@nestjs/platform-express';
import type { Multer } from 'multer';
import { ensureUuid } from '../../common/errors/ensure-uuid';
import { CreateRenderVideoDto } from './dto/create-render-video.dto';
import { CreateTestRenderVideoDto } from './dto/create-test-render-video.dto';
import { CreateRenderVideoUrlDto } from './dto/create-render-video-url.dto';
import { RenderVideosService } from './render-videos.service';
import { isSubscribeLikeSentence } from './render-videos.constants';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const normalizeVolume = (raw: number) => {
  if (!Number.isFinite(raw)) return undefined;
  // Be forgiving: accept 0..1 (normalized) or 0..100 (percent).
  if (raw > 1 && raw <= 100) return clamp01(raw / 100);
  return clamp01(raw);
};
import type { SentenceInput } from './render-videos.types';

@Controller('videos')
export class RenderVideosController {
  constructor(private readonly renderVideosService: RenderVideosService) {}

  private parseMultipartSentences(body: { sentences: string }) {
    let sentences: Array<{
      text: string;
      isSuspense?: boolean;
      soundEffectsAlignToSceneEnd?: boolean;
      mediaType?: 'image' | 'video';
      videoUrl?: string;
      soundEffects?: Array<{
        src: string;
        delaySeconds?: number;
        durationSeconds?: number;
        volumePercent?: number;
      }>;
      transitionSoundEffects?: Array<{
        src: string;
        delaySeconds?: number;
        volumePercent?: number;
      }>;
      transitionToNext?:
        | 'none'
        | 'glitch'
        | 'whip'
        | 'flash'
        | 'fade'
        | 'chromaLeak'
        | null;
      visualEffect?:
        | 'none'
        | 'colorGrading'
        | 'animatedLighting'
        | 'glassSubtle'
        | 'glassReflections'
        | 'glassStrong'
        | null;
      imageMotionEffect?:
        | 'default'
        | 'slowZoomIn'
        | 'slowZoomOut'
        | 'diagonalDrift'
        | 'cinematicPan'
        | 'focusShift'
        | 'parallaxMotion'
        | 'shakeMicroMotion'
        | 'splitMotion'
        | 'rotationDrift'
        | null;
      imageMotionSpeed?: number | null;
      imageEffectsMode?: 'quick' | 'detailed' | null;
      imageFilterId?: string | null;
      imageFilterSettings?: Record<string, unknown> | null;
      motionEffectId?: string | null;
      imageMotionSettings?: Record<string, unknown> | null;
    }>;

    try {
      sentences = JSON.parse(body.sentences) as typeof sentences;
    } catch {
      throw new BadRequestException('Invalid `sentences` JSON');
    }

    return sentences;
  }

  private validateMultipartSentences(
    sentences: Array<{
      text: string;
      isSuspense?: boolean;
      soundEffectsAlignToSceneEnd?: boolean;
      mediaType?: 'image' | 'video';
      videoUrl?: string;
      soundEffects?: Array<{
        src: string;
        delaySeconds?: number;
        durationSeconds?: number;
        volumePercent?: number;
      }>;
      transitionSoundEffects?: Array<{
        src: string;
        delaySeconds?: number;
        volumePercent?: number;
      }>;
      transitionToNext?:
        | 'none'
        | 'glitch'
        | 'whip'
        | 'flash'
        | 'fade'
        | 'chromaLeak'
        | null;
      visualEffect?:
        | 'none'
        | 'colorGrading'
        | 'animatedLighting'
        | 'glassSubtle'
        | 'glassReflections'
        | 'glassStrong'
        | null;
      imageMotionEffect?:
        | 'default'
        | 'slowZoomIn'
        | 'slowZoomOut'
        | 'diagonalDrift'
        | 'cinematicPan'
        | 'focusShift'
        | 'parallaxMotion'
        | 'shakeMicroMotion'
        | 'splitMotion'
        | 'rotationDrift'
        | null;
      imageMotionSpeed?: number | null;
      imageEffectsMode?: 'quick' | 'detailed' | null;
      imageFilterId?: string | null;
      imageFilterSettings?: Record<string, unknown> | null;
      motionEffectId?: string | null;
      imageMotionSettings?: Record<string, unknown> | null;
    }>,
    minimumCount = 1,
  ) {
    if (!Array.isArray(sentences) || sentences.length < minimumCount) {
      throw new BadRequestException(
        minimumCount > 1
          ? `\`sentences\` must contain at least ${minimumCount} items`
          : '`sentences` must be a non-empty array',
      );
    }

    const allowedTransitions = new Set([
      'none',
      'glitch',
      'whip',
      'flash',
      'fade',
      'chromaLeak',
    ] as const);

    const allowedVisualEffects = new Set([
      'none',
      'colorGrading',
      'animatedLighting',
      'glassSubtle',
      'glassReflections',
      'glassStrong',
    ] as const);

    const allowedImageMotionEffects = new Set([
      'default',
      'slowZoomIn',
      'slowZoomOut',
      'diagonalDrift',
      'cinematicPan',
      'focusShift',
      'parallaxMotion',
      'shakeMicroMotion',
      'splitMotion',
      'rotationDrift',
    ] as const);

    for (const [idx, s] of sentences.entries()) {
      const mediaType = s?.mediaType;
      if (mediaType && mediaType !== 'image' && mediaType !== 'video') {
        throw new BadRequestException(
          `Invalid mediaType for sentence ${idx + 1}. Expected 'image' or 'video'.`,
        );
      }

      const t = (s as any)?.transitionToNext;
      if (t != null) {
        if (typeof t !== 'string' || !allowedTransitions.has(t as any)) {
          throw new BadRequestException(
            `Invalid transitionToNext for sentence ${idx + 1}.`,
          );
        }
      }

      const ve = (s as any)?.visualEffect;
      if (ve != null) {
        if (typeof ve !== 'string' || !allowedVisualEffects.has(ve as any)) {
          throw new BadRequestException(
            `Invalid visualEffect for sentence ${idx + 1}.`,
          );
        }
      }

      const ime = (s as any)?.imageMotionEffect;
      if (ime != null) {
        if (
          typeof ime !== 'string' ||
          !allowedImageMotionEffects.has(ime as any)
        ) {
          throw new BadRequestException(
            `Invalid imageMotionEffect for sentence ${idx + 1}.`,
          );
        }
      }

      const ims = (s as any)?.imageMotionSpeed;
      if (ims != null) {
        const numericSpeed = Number(ims);
        if (
          !Number.isFinite(numericSpeed) ||
          numericSpeed < 0.5 ||
          numericSpeed > 2.5
        ) {
          throw new BadRequestException(
            `Invalid imageMotionSpeed for sentence ${idx + 1}.`,
          );
        }
      }

      const imageEffectsMode = (s as any)?.imageEffectsMode;
      if (
        imageEffectsMode != null &&
        imageEffectsMode !== 'quick' &&
        imageEffectsMode !== 'detailed'
      ) {
        throw new BadRequestException(
          `Invalid imageEffectsMode for sentence ${idx + 1}.`,
        );
      }

      const imageFilterSettings = (s as any)?.imageFilterSettings;
      if (
        imageFilterSettings != null &&
        (typeof imageFilterSettings !== 'object' ||
          Array.isArray(imageFilterSettings))
      ) {
        throw new BadRequestException(
          `Invalid imageFilterSettings for sentence ${idx + 1}.`,
        );
      }

      const imageMotionSettings = (s as any)?.imageMotionSettings;
      if (
        imageMotionSettings != null &&
        (typeof imageMotionSettings !== 'object' ||
          Array.isArray(imageMotionSettings))
      ) {
        throw new BadRequestException(
          `Invalid imageMotionSettings for sentence ${idx + 1}.`,
        );
      }

      if (mediaType === 'video') {
        const url = String(s.videoUrl ?? '').trim();
        const ok =
          url.startsWith('http://') ||
          url.startsWith('https://') ||
          url === '/subscribe.mp4';
        if (!ok) {
          throw new BadRequestException(
            `Missing or invalid videoUrl for sentence ${idx + 1} on video tab.`,
          );
        }
      }

      const soundEffects = (s as any)?.soundEffects;
      const soundEffectsAlignToSceneEnd = (s as any)?.soundEffectsAlignToSceneEnd;
      if (
        soundEffectsAlignToSceneEnd != null &&
        typeof soundEffectsAlignToSceneEnd !== 'boolean'
      ) {
        throw new BadRequestException(
          `Invalid soundEffectsAlignToSceneEnd for sentence ${idx + 1}.`,
        );
      }

      if (soundEffects != null) {
        if (!Array.isArray(soundEffects)) {
          throw new BadRequestException(
            `Invalid soundEffects for sentence ${idx + 1}. Expected an array.`,
          );
        }

        for (const [sfxIdx, se] of soundEffects.entries()) {
          const src = String(se?.src ?? '').trim();
          const ok = src.startsWith('http://') || src.startsWith('https://');
          if (!ok) {
            throw new BadRequestException(
              `Invalid soundEffects[${sfxIdx}] src for sentence ${idx + 1}. Expected http(s) URL.`,
            );
          }

          const delayRaw = se?.delaySeconds;
          if (delayRaw != null) {
            const v = Number(delayRaw);
            if (!Number.isFinite(v) || v < 0) {
              throw new BadRequestException(
                `Invalid soundEffects[${sfxIdx}] delaySeconds for sentence ${idx + 1}.`,
              );
            }
          }

          const durationRaw = se?.durationSeconds;
          if (durationRaw != null) {
            const v = Number(durationRaw);
            if (!Number.isFinite(v) || v < 0) {
              throw new BadRequestException(
                `Invalid soundEffects[${sfxIdx}] durationSeconds for sentence ${idx + 1}.`,
              );
            }
          }

          const volRaw = se?.volumePercent;
          if (volRaw != null) {
            const v = Number(volRaw);
            if (!Number.isFinite(v) || v < 0 || v > 300) {
              throw new BadRequestException(
                `Invalid soundEffects[${sfxIdx}] volumePercent for sentence ${idx + 1}.`,
              );
            }
          }
        }
      }

      const transitionSoundEffects = (s as any)?.transitionSoundEffects;
      if (transitionSoundEffects != null) {
        if (!Array.isArray(transitionSoundEffects)) {
          throw new BadRequestException(
            `Invalid transitionSoundEffects for sentence ${idx + 1}. Expected an array.`,
          );
        }

        for (const [sfxIdx, se] of transitionSoundEffects.entries()) {
          const src = String(se?.src ?? '').trim();
          const ok = src.startsWith('http://') || src.startsWith('https://');
          if (!ok) {
            throw new BadRequestException(
              `Invalid transitionSoundEffects[${sfxIdx}] src for sentence ${idx + 1}. Expected http(s) URL.`,
            );
          }

          const delayRaw = se?.delaySeconds;
          if (delayRaw != null) {
            const v = Number(delayRaw);
            if (!Number.isFinite(v) || v < 0) {
              throw new BadRequestException(
                `Invalid transitionSoundEffects[${sfxIdx}] delaySeconds for sentence ${idx + 1}.`,
              );
            }
          }

          const volRaw = se?.volumePercent;
          if (volRaw != null) {
            const v = Number(volRaw);
            if (!Number.isFinite(v) || v < 0 || v > 300) {
              throw new BadRequestException(
                `Invalid transitionSoundEffects[${sfxIdx}] volumePercent for sentence ${idx + 1}.`,
              );
            }
          }
        }
      }
    }
  }

  private alignUploadedImages(
    sentences: Array<{
      text: string;
      mediaType?: 'image' | 'video';
      videoUrl?: string;
    }>,
    images: Multer.File[],
  ) {
    const alignedImages: Array<Multer.File | null> = [];
    let imageCursor = 0;
    for (const s of sentences) {
      const isSubscribe = isSubscribeLikeSentence(s.text || '');
      const wantsVideo =
        s.mediaType === 'video' && !!String(s.videoUrl ?? '').trim();
      if (isSubscribe || wantsVideo) {
        alignedImages.push(null);
      } else {
        alignedImages.push(images[imageCursor] ?? null);
        imageCursor += 1;
      }
    }
    return alignedImages;
  }

  private parseMultipartRenderOptions(
    body: CreateRenderVideoDto | CreateTestRenderVideoDto,
  ) {
    const audioDurationSeconds = body.audioDurationSeconds
      ? Number(body.audioDurationSeconds)
      : undefined;

    const useLowerFps = body.useLowerFps === 'true';
    const useLowerResolution = body.useLowerResolution === 'true';
    const enableGlitchTransitions = body.enableGlitchTransitions === 'true';
    const addSubtitles =
      typeof body.addSubtitles === 'string'
        ? body.addSubtitles === 'true'
        : undefined;
    const isShort =
      typeof body.isShort === 'string' ? body.isShort === 'true' : undefined;

    const rawBackgroundMusicSrc = String(body.backgroundMusicSrc ?? '').trim();
    const backgroundMusicSrc =
      rawBackgroundMusicSrc === '__none__'
        ? null
        : rawBackgroundMusicSrc
          ? rawBackgroundMusicSrc
          : undefined;

    const rawBackgroundMusicVolume = String(
      (body as any).backgroundMusicVolume ?? '',
    ).trim();
    const parsedBackgroundMusicVolume = rawBackgroundMusicVolume
      ? Number(rawBackgroundMusicVolume)
      : NaN;
    const backgroundMusicVolume = Number.isFinite(parsedBackgroundMusicVolume)
      ? normalizeVolume(parsedBackgroundMusicVolume)
      : undefined;

    return {
      audioDurationSeconds,
      useLowerFps,
      useLowerResolution,
      enableGlitchTransitions,
      addSubtitles,
      isShort,
      backgroundMusicSrc,
      backgroundMusicVolume,
    };
  }

  @Get()
  info() {
    // Many users try to open /videos in the browser.
    // Rendering is started via POST requests.
    throw new MethodNotAllowedException({
      message:
        'Use POST /videos (multipart) or POST /videos/url (JSON) to start a render. Use GET /videos/:id to poll status.',
      endpoints: {
        createMultipart: {
          method: 'POST',
          path: '/videos',
          contentType: 'multipart/form-data',
          fields: [
            'voiceOver (file)',
            'images (files)',
            'sentences (json string)',
            'scriptLength',
          ],
        },
        createFromUrls: {
          method: 'POST',
          path: '/videos/url',
          contentType: 'application/json',
          fields: ['audioUrl', 'imageUrls[]', 'sentences[]', 'scriptLength'],
        },
        createTestRender: {
          method: 'POST',
          path: '/videos/test',
          contentType: 'multipart/form-data',
          fields: [
            'voiceOver (file, optional when isSilent=true)',
            'images (files)',
            'sentences (json string)',
            'scriptLength',
            'isSilent (optional)',
          ],
        },
        poll: {
          method: 'GET',
          path: '/videos/:id',
        },
        uploadFinalVideo: {
          method: 'POST',
          path: '/videos/upload',
          contentType: 'multipart/form-data',
          fields: ['video (file)'],
        },
      },
    });
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('video', {
      limits: {
        files: 1,
        // Allow larger uploads; adjust if needed.
        fileSize: 250 * 1024 * 1024,
        fields: 10,
      },
    }),
  )
  async uploadFinalVideo(@UploadedFile() video?: Multer.File) {
    if (this.renderVideosService.isServerlessRuntime()) {
      throw new ServiceUnavailableException(
        'Uploading videos is not supported on serverless runtimes when Cloudinary video uploads are disabled.',
      );
    }

    if (!video?.buffer?.length) {
      throw new BadRequestException('Missing `video` upload');
    }

    const job = await this.renderVideosService.createUploadedVideoJob({
      videoFile: {
        buffer: video.buffer,
        originalName: video.originalname,
        mimeType: video.mimetype,
      },
    });

    return {
      id: job.id,
      status: job.status,
      videoUrl: job.videoPath,
    };
  }

  @Post('url')
  async createFromUrls(@Body() body: CreateRenderVideoUrlDto) {
    if (this.renderVideosService.isServerlessRuntime()) {
      throw new ServiceUnavailableException(
        'Video rendering jobs cannot run reliably on Vercel Serverless. Deploy the backend to a long-running server (Render/Railway/Fly) or run a dedicated worker for Remotion rendering.',
      );
    }

    if (!body?.audioUrl) {
      throw new BadRequestException('Missing `audioUrl`');
    }

    const urlSentences = body.sentences;
    if (!Array.isArray(urlSentences) || urlSentences.length === 0) {
      throw new BadRequestException('`sentences` must be a non-empty array');
    }

    const sentences: SentenceInput[] = urlSentences.map((s) => ({
      text: s.text,
      isSuspense: s.isSuspense,
      soundEffectsAlignToSceneEnd: s.soundEffectsAlignToSceneEnd,
      mediaType: 'image',
      ...(Array.isArray((s as any).soundEffects)
        ? { soundEffects: (s as any).soundEffects }
        : {}),
      ...(Array.isArray((s as any).transitionSoundEffects)
        ? { transitionSoundEffects: (s as any).transitionSoundEffects }
        : {}),
      ...(s.transitionToNext != null
        ? { transitionToNext: s.transitionToNext }
        : {}),
      ...(s.visualEffect != null ? { visualEffect: s.visualEffect } : {}),
      ...(s.imageMotionEffect != null
        ? { imageMotionEffect: s.imageMotionEffect }
        : {}),
      ...(s.imageMotionSpeed != null
        ? { imageMotionSpeed: s.imageMotionSpeed }
        : {}),
      ...(s.imageEffectsMode != null
        ? { imageEffectsMode: s.imageEffectsMode }
        : {}),
      ...(s.imageFilterId != null ? { imageFilterId: s.imageFilterId } : {}),
      ...(s.imageFilterSettings != null
        ? { imageFilterSettings: s.imageFilterSettings }
        : {}),
      ...(s.motionEffectId != null ? { motionEffectId: s.motionEffectId } : {}),
      ...(s.imageMotionSettings != null
        ? { imageMotionSettings: s.imageMotionSettings }
        : {}),
    }));

    const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls : [];
    if (imageUrls.length !== sentences.length) {
      throw new BadRequestException(
        '`imageUrls` must have the same length as `sentences`',
      );
    }

    const backgroundMusicVolume =
      typeof body.backgroundMusicVolume === 'number'
        ? normalizeVolume(body.backgroundMusicVolume)
        : undefined;

    const job = await this.renderVideosService.createJob({
      language:
        typeof body.language === 'string' ? body.language.trim() : undefined,
      audioFile: null,
      audioUrl: body.audioUrl,
      sentences,
      imageFiles: new Array(sentences.length).fill(null),
      imageUrls,
      scriptLength: body.scriptLength,
      audioDurationSeconds: body.audioDurationSeconds,
      isShort: body.isShort,
      useLowerFps: !!body.useLowerFps,
      useLowerResolution: !!body.useLowerResolution,
      addSubtitles: body.addSubtitles,
      enableGlitchTransitions: !!body.enableGlitchTransitions,
      backgroundMusicSrc:
        typeof body.backgroundMusicSrc === 'string'
          ? body.backgroundMusicSrc
          : body.backgroundMusicSrc === null
            ? null
            : undefined,
      backgroundMusicVolume,
    });

    return { id: job.id, status: job.status, isShort: body.isShort ?? null };
  }

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'voiceOver', maxCount: 1 },
        { name: 'images', maxCount: 200 },
      ],
      {
        // Intentionally use memory storage (no local disk writes).
        // Limits help avoid OOM/timeouts (especially on serverless platforms).
        limits: {
          files: 201,
          // Per-file size limit (bytes). Tune as needed for your typical inputs.
          fileSize: 10 * 1024 * 1024,
          fields: 50,
        },
      },
    ),
  )
  async create(
    @Body() body: CreateRenderVideoDto,
    @UploadedFiles()
    files: {
      voiceOver?: Multer.File[];
      images?: Multer.File[];
    },
  ) {
    if (this.renderVideosService.isServerlessRuntime()) {
      throw new ServiceUnavailableException(
        'Video rendering jobs cannot run reliably on serverless runtimes when Cloudinary video uploads are disabled. Deploy the backend to a long-running server (Render/Railway/Fly).',
      );
    }

    const voice = files.voiceOver?.[0];
    const images = files.images ?? [];
    const sentences = this.parseMultipartSentences(body);
    this.validateMultipartSentences(sentences, 1);

    if (!voice?.buffer?.length) {
      throw new BadRequestException('Missing `voiceOver` upload');
    }

    const alignedImages = this.alignUploadedImages(sentences, images);
    const {
      audioDurationSeconds,
      useLowerFps,
      useLowerResolution,
      enableGlitchTransitions,
      addSubtitles,
      isShort,
      backgroundMusicSrc,
      backgroundMusicVolume,
    } = this.parseMultipartRenderOptions(body);

    const job = await this.renderVideosService.createJob({
      language:
        typeof body.language === 'string' ? body.language.trim() : undefined,
      audioFile: voice
        ? {
            buffer: voice.buffer,
            originalName: voice.originalname,
            mimeType: voice.mimetype,
          }
        : null,
      sentences,
      imageFiles: alignedImages.map((f) =>
        f
          ? {
              buffer: f.buffer,
              originalName: f.originalname,
              mimeType: f.mimetype,
            }
          : null,
      ),
      scriptLength: body.scriptLength,
      audioDurationSeconds,
      isShort,
      useLowerFps,
      useLowerResolution,
      addSubtitles,
      enableGlitchTransitions,
      backgroundMusicSrc,
      backgroundMusicVolume,
    });

    return { id: job.id, status: job.status, isShort: isShort ?? null };
  }

  @Post('test')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'voiceOver', maxCount: 1 },
        { name: 'images', maxCount: 200 },
      ],
      {
        limits: {
          files: 201,
          fileSize: 10 * 1024 * 1024,
          fields: 60,
        },
      },
    ),
  )
  async createTestRender(
    @Body() body: CreateTestRenderVideoDto,
    @UploadedFiles()
    files: {
      voiceOver?: Multer.File[];
      images?: Multer.File[];
    },
  ) {
    if (this.renderVideosService.isServerlessRuntime()) {
      throw new ServiceUnavailableException(
        'Video rendering jobs cannot run reliably on serverless runtimes when Cloudinary video uploads are disabled. Deploy the backend to a long-running server (Render/Railway/Fly).',
      );
    }

    const voice = files.voiceOver?.[0];
    const images = files.images ?? [];
    const sentences = this.parseMultipartSentences(body);
    this.validateMultipartSentences(sentences, 2);

    const isSilent = body.isSilent === 'true';
    if (!isSilent && !voice?.buffer?.length) {
      throw new BadRequestException(
        'Missing `voiceOver` upload for non-silent test render',
      );
    }

    const alignedImages = this.alignUploadedImages(sentences, images);
    const {
      audioDurationSeconds,
      useLowerFps,
      useLowerResolution,
      enableGlitchTransitions,
      addSubtitles,
      isShort,
      backgroundMusicSrc,
      backgroundMusicVolume,
    } = this.parseMultipartRenderOptions(body);

    const job = await this.renderVideosService.createJob({
      language:
        typeof body.language === 'string' ? body.language.trim() : undefined,
      audioFile: voice
        ? {
            buffer: voice.buffer,
            originalName: voice.originalname,
            mimeType: voice.mimetype,
          }
        : null,
      allowSilentAudio: isSilent,
      sentences,
      imageFiles: alignedImages.map((f) =>
        f
          ? {
              buffer: f.buffer,
              originalName: f.originalname,
              mimeType: f.mimetype,
            }
          : null,
      ),
      scriptLength: body.scriptLength,
      audioDurationSeconds,
      isShort,
      useLowerFps,
      useLowerResolution,
      addSubtitles,
      enableGlitchTransitions,
      backgroundMusicSrc,
      backgroundMusicVolume,
    });

    return { id: job.id, status: job.status, isShort: isShort ?? null };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    ensureUuid(id);
    const job = await this.renderVideosService.getJob(id);
    await this.renderVideosService.failIfStale(job);
    const updated = await this.renderVideosService.getJob(id);
    const derivedIsShort =
      updated.timeline &&
      typeof updated.timeline.width === 'number' &&
      typeof updated.timeline.height === 'number'
        ? updated.timeline.height > updated.timeline.width
        : null;
    return {
      id: updated.id,
      status: updated.status,
      error: updated.error,
      videoUrl: updated.videoPath ? updated.videoPath : null,
      timeline: updated.timeline,
      isShort: derivedIsShort,
      lastProgressAt: updated.lastProgressAt ?? null,
      updatedAt: (updated as any).updatedAt ?? null,
      createdAt: (updated as any).createdAt ?? null,
    };
  }
}
