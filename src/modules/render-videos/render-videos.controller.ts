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
import { CreateRenderVideoUrlDto } from './dto/create-render-video-url.dto';
import { RenderVideosService } from './render-videos.service';
import {
  SHORTS_CTA_SENTENCE,
  SUBSCRIBE_SENTENCE,
  isSubscribeLikeSentence,
} from './render-videos.constants';

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
      mediaType: 'image',
      ...(s.transitionToNext != null
        ? { transitionToNext: s.transitionToNext }
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

    let sentences: Array<{
      text: string;
      isSuspense?: boolean;
      mediaType?: 'image' | 'video';
      videoUrl?: string;
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
        | null;
    }>;
    try {
      sentences = JSON.parse(body.sentences) as Array<{
        text: string;
        isSuspense?: boolean;
        mediaType?: 'image' | 'video';
        videoUrl?: string;
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
          | null;
      }>;
    } catch {
      throw new BadRequestException('Invalid `sentences` JSON');
    }

    if (!Array.isArray(sentences) || sentences.length === 0) {
      throw new BadRequestException('`sentences` must be a non-empty array');
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
    }

    if (!voice?.buffer?.length) {
      throw new BadRequestException('Missing `voiceOver` upload');
    }

    const audioDurationSeconds = body.audioDurationSeconds
      ? Number(body.audioDurationSeconds)
      : undefined;

    // Preserve alignment between sentences and uploaded media.
    // The frontend does not upload an image for:
    // - the subscribe sentence (uses a built-in subscribe video)
    // - sentences on the video tab (they provide a sentence-level videoUrl)
    // So we map uploaded images to image-tab sentences in order and insert null otherwise.
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

    const job = await this.renderVideosService.createJob({
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
