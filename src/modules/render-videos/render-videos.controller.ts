import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Multer } from 'multer';
import { CreateRenderVideoDto } from './dto/create-render-video.dto';
import { RenderVideosService } from './render-videos.service';

const SUBSCRIBE_SENTENCE =
  'Please Subscribe & Help us reach out to more people';

@Controller('videos')
export class RenderVideosController {
  constructor(private readonly renderVideosService: RenderVideosService) {}

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
      useLowerFps,
      useLowerResolution,
      enableGlitchTransitions,
    });

    return { id: job.id, status: job.status };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const job = await this.renderVideosService.getJob(id);
    return {
      id: job.id,
      status: job.status,
      error: job.error,
      videoUrl: job.videoPath ? job.videoPath : null,
      timeline: job.timeline,
    };
  }
}
