import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import type { Multer } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { CreateRenderVideoDto } from './dto/create-render-video.dto';
import { RenderVideosService } from './render-videos.service';

const storage = diskStorage({
  destination: (_req, file, cb) => {
    const sub = file.fieldname === 'voiceOver' ? 'audio' : 'images';
    const dir = join(process.cwd(), 'storage', sub);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir as string);
  },
  filename: (_req, file, cb) => {
    cb(null, `${randomUUID()}${extname(file.originalname)}`);
  },
});

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
      { storage },
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

    const sentences = JSON.parse(body.sentences) as Array<{ text: string }>;
    const audioDurationSeconds = body.audioDurationSeconds
      ? Number(body.audioDurationSeconds)
      : undefined;

    const audioPath = voice
      ? join(process.cwd(), 'storage', 'audio', voice.filename)
      : '';
    const imagePaths = images.map((f) =>
      join(process.cwd(), 'storage', 'images', f.filename),
    );
    const useLowerFps = body.useLowerFps === 'true';
    const useLowerResolution = body.useLowerResolution === 'true';
    const enableGlitchTransitions = body.enableGlitchTransitions === 'true';

    const job = await this.renderVideosService.createJob({
      audioPath,
      sentences,
      imagePaths,
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


