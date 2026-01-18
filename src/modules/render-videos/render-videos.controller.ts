import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  ServiceUnavailableException,
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

    return { id: job.id, status: job.status };
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

    let sentences: Array<{ text: string }>;
    try {
      sentences = JSON.parse(body.sentences) as Array<{ text: string }>;
    } catch {
      throw new BadRequestException('Invalid `sentences` JSON');
    }

    if (!Array.isArray(sentences) || sentences.length === 0) {
      throw new BadRequestException('`sentences` must be a non-empty array');
    }

    if (!voice?.buffer?.length) {
      throw new BadRequestException('Missing `voiceOver` upload');
    }

    const audioDurationSeconds = body.audioDurationSeconds
      ? Number(body.audioDurationSeconds)
      : undefined;

    // Preserve alignment between sentences and uploaded media.
    // The frontend does not upload an image for the subscribe sentence (it uses a built-in subscribe video),
    // so we map uploaded images to non-subscribe sentences in order and insert null for the subscribe sentence.
    const alignedImages: Array<Multer.File | null> = [];
    let imageCursor = 0;
    for (const s of sentences) {
      const isSubscribe = (s.text || '').trim() === SUBSCRIBE_SENTENCE;
      if (isSubscribe) {
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

    return { id: job.id, status: job.status };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    ensureUuid(id);
    const job = await this.renderVideosService.getJob(id);
    await this.renderVideosService.failIfStale(job);
    const updated = await this.renderVideosService.getJob(id);
    return {
      id: updated.id,
      status: updated.status,
      error: updated.error,
      videoUrl: updated.videoPath ? updated.videoPath : null,
      timeline: updated.timeline,
    };
  }
}
