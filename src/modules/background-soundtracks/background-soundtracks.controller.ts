import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BackgroundSoundtracksService } from './background-soundtracks.service';
import { CreateBackgroundSoundtrackDto } from './dto/create-background-soundtrack.dto';
import { UpdateBackgroundSoundtrackVolumeDto } from './dto/update-background-soundtrack-volume.dto';

@Controller('background-soundtracks')
export class BackgroundSoundtracksController {
  constructor(private readonly service: BackgroundSoundtracksService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(
    @Req() req: Request,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    const pageNum = Number.parseInt(page, 10) || 1;
    const limitNum = Number.parseInt(limit, 10) || 50;

    return this.service.findAllByUser(user_id, pageNum, limitNum);
  }

  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('soundtrack', {
      limits: { files: 1, fileSize: 15 * 1024 * 1024 },
    }),
  )
  async uploadUseOnce(@UploadedFile() file: any) {
    if (!file?.buffer) {
      throw new BadRequestException('No soundtrack file uploaded');
    }

    const mimetype = String(file?.mimetype ?? '');
    if (mimetype && !mimetype.startsWith('audio/')) {
      throw new BadRequestException(
        `Invalid file type for soundtrack upload: ${mimetype}. Expected an audio/* mime type.`,
      );
    }

    const uploaded = await this.service.uploadUseOnce({
      buffer: file.buffer,
      filename: file.originalname,
    });

    return {
      url: uploaded.url,
      public_id: uploaded.public_id,
      hash: uploaded.hash,
    };
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('soundtrack', {
      limits: { files: 1, fileSize: 15 * 1024 * 1024 },
    }),
  )
  async create(
    @UploadedFile() file: any,
    @Body() body: CreateBackgroundSoundtrackDto,
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    if (!file?.buffer) {
      throw new BadRequestException(
        'No soundtrack file uploaded. If deploying on Vercel, consider direct-to-Cloudinary uploads and then POST a URL endpoint.',
      );
    }

    const mimetype = String(file?.mimetype ?? '');
    if (mimetype && !mimetype.startsWith('audio/')) {
      throw new BadRequestException(
        `Invalid file type for soundtrack upload: ${mimetype}. Expected an audio/* mime type.`,
      );
    }

    const title = String(body?.title ?? '').trim();
    if (!title) {
      throw new BadRequestException('Missing `title`');
    }

    return this.service.uploadAndCreate({
      buffer: file.buffer,
      filename: file.originalname,
      title,
      user_id,
    });
  }

  @Patch('favorite/:soundtrackId')
  @UseGuards(JwtAuthGuard)
  async setFavorite(
    @Req() req: Request,
    @Param('soundtrackId') soundtrackId: string,
  ) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.service.setFavoriteById({ user_id, soundtrackId });
  }

  @Patch('volume/:soundtrackId')
  @UseGuards(JwtAuthGuard)
  async setVolume(
    @Req() req: Request,
    @Param('soundtrackId') soundtrackId: string,
    @Body() body: UpdateBackgroundSoundtrackVolumeDto,
  ) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.service.setVolumeById({
      user_id,
      soundtrackId,
      volumePercent: body?.volumePercent,
    });
  }
}
