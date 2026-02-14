import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  ServiceUnavailableException,
  MethodNotAllowedException,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Multer } from 'multer';
import { ensureUuid } from '../../common/errors/ensure-uuid';
import { CreateRenderVideoDto } from './dto/create-render-video.dto';
import { CreateRenderVideoUrlDto } from './dto/create-render-video-url.dto';
import { RenderVideosService } from './render-videos.service';

const SUBSCRIBE_SENTENCE =
  'Please Subscribe & Help us reach out to more people';

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
      },
    });
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

    const sentences = body.sentences;
    if (!Array.isArray(sentences) || sentences.length === 0) {
      throw new BadRequestException('`sentences` must be a non-empty array');
    }

    const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls : [];
    if (imageUrls.length !== sentences.length) {
      throw new BadRequestException(
        '`imageUrls` must have the same length as `sentences`',
      );
    }

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
      enableGlitchTransitions: !!body.enableGlitchTransitions,
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
    const voice = files.voiceOver?.[0];
    const images = files.images ?? [];

    let sentences: Array<{
      text: string;
      isSuspense?: boolean;
      mediaType?: 'image' | 'video';
      videoUrl?: string;
    }>;
    try {
      sentences = JSON.parse(body.sentences) as Array<{
        text: string;
        isSuspense?: boolean;
        mediaType?: 'image' | 'video';
        videoUrl?: string;
      }>;
    } catch {
      throw new BadRequestException('Invalid `sentences` JSON');
    }

    if (!Array.isArray(sentences) || sentences.length === 0) {
      throw new BadRequestException('`sentences` must be a non-empty array');
    }

    for (const [idx, s] of sentences.entries()) {
      const mediaType = s?.mediaType;
      if (mediaType && mediaType !== 'image' && mediaType !== 'video') {
        throw new BadRequestException(
          `Invalid mediaType for sentence ${idx + 1}. Expected 'image' or 'video'.`,
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
      const isSubscribe = (s.text || '').trim() === SUBSCRIBE_SENTENCE;
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
    const isShort =
      typeof body.isShort === 'string' ? body.isShort === 'true' : undefined;

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
      enableGlitchTransitions,
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
    };
  }
}
