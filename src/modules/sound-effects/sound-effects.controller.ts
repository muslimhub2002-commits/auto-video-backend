import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SoundEffectsService } from './sound-effects.service';
import { CreateSoundEffectDto } from './dto/create-sound-effect.dto';
import { UpdateSoundEffectVolumeDto } from './dto/update-sound-effect-volume.dto';
import { MergeSoundEffectsDto } from './dto/merge-sound-effects.dto';
import { UpdateSoundEffectDto } from './dto/update-sound-effect.dto';
import { UpdateSoundEffectTransitionDto } from './dto/update-sound-effect-transition.dto';
import { SaveSoundEffectPresetDto } from './dto/save-sound-effect-preset.dto';

@Controller('sound-effects')
@UseGuards(JwtAuthGuard)
export class SoundEffectsController {
  constructor(private readonly service: SoundEffectsService) {}

  @Get()
  async findAll(
    @Req() req: Request,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
    @Query('q') q: string = '',
  ) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) throw new UnauthorizedException('User not found in request');

    const pageNum = Number.parseInt(page, 10) || 1;
    // Enforce a fixed page size for consistent UX in the library.
    // Keep the query param for backward compatibility, but ignore its value.
    void limit;
    const limitNum = 20;

    return this.service.findAllByUser(user_id, pageNum, limitNum, q);
  }

  @Get('transitions')
  async findTransitionSounds(
    @Req() req: Request,
    @Query('page') page: string = '1',
    @Query('q') q: string = '',
  ) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) throw new UnauthorizedException('User not found in request');

    const pageNum = Number.parseInt(page, 10) || 1;
    return this.service.findTransitionSoundsByUser(user_id, pageNum, q);
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('soundEffect', {
      limits: { files: 1, fileSize: 15 * 1024 * 1024 },
    }),
  )
  async create(
    @Req() req: Request,
    @UploadedFile() file: any,
    @Body() body: CreateSoundEffectDto,
  ) {
    const user = (req as any).user;
    const user_id = user?.id;
    if (!user_id) throw new UnauthorizedException('User not found in request');

    if (!file?.buffer) {
      throw new BadRequestException('No sound effect uploaded');
    }

    const mimetype = String(file?.mimetype ?? '');
    if (mimetype && !mimetype.startsWith('audio/')) {
      throw new BadRequestException(
        `Invalid file type for sound effect upload: ${mimetype}. Expected an audio/* mime type.`,
      );
    }

    return this.service.uploadAndCreate({
      user_id,
      buffer: file.buffer,
      filename: file.originalname,
      title: body?.title,
      name: (body as any)?.name,
      volumePercent: body?.volumePercent,
      audioSettings: body?.audioSettings,
    });
  }

  @Post('batch')
  @UseInterceptors(
    FilesInterceptor('soundEffects', 20, {
      limits: { files: 20, fileSize: 15 * 1024 * 1024 },
    }),
  )
  async createBatch(@Req() req: Request, @UploadedFiles() files: any[]) {
    const user = (req as any).user;
    const user_id = user?.id;
    if (!user_id) throw new UnauthorizedException('User not found in request');

    const list = Array.isArray(files) ? files : [];
    if (list.length === 0) {
      throw new BadRequestException('No sound effects uploaded');
    }

    for (const f of list) {
      if (!f?.buffer) {
        throw new BadRequestException('Invalid sound effect upload');
      }

      const mimetype = String(f?.mimetype ?? '');
      if (mimetype && !mimetype.startsWith('audio/')) {
        throw new BadRequestException(
          `Invalid file type for sound effect upload: ${mimetype}. Expected an audio/* mime type.`,
        );
      }
    }

    const items = await Promise.all(
      list.map((f) =>
        this.service.uploadAndCreate({
          user_id,
          buffer: f.buffer,
          filename: f.originalname,
        }),
      ),
    );

    return { items };
  }

  @Patch('volume/:soundEffectId')
  async setVolume(
    @Req() req: Request,
    @Param('soundEffectId') soundEffectId: string,
    @Body() body: UpdateSoundEffectVolumeDto,
  ) {
    const user = (req as any).user;
    const user_id = user?.id;
    if (!user_id) throw new UnauthorizedException('User not found in request');

    return this.service.setVolumeById({
      user_id,
      soundEffectId,
      volumePercent: body?.volumePercent,
    });
  }

  @Patch('transition/:soundEffectId')
  async setTransitionSound(
    @Req() req: Request,
    @Param('soundEffectId') soundEffectId: string,
    @Body() body: UpdateSoundEffectTransitionDto,
  ) {
    const user = (req as any).user;
    const user_id = user?.id;
    if (!user_id) throw new UnauthorizedException('User not found in request');

    return this.service.setTransitionSoundById({
      user_id,
      soundEffectId,
      isTransitionSound: Boolean(body?.isTransitionSound),
    });
  }

  @Patch(':soundEffectId')
  async update(
    @Req() req: Request,
    @Param('soundEffectId') soundEffectId: string,
    @Body() body: UpdateSoundEffectDto,
  ) {
    const user = (req as any).user;
    const user_id = user?.id;
    if (!user_id) throw new UnauthorizedException('User not found in request');

    return this.service.updateById({
      user_id,
      soundEffectId,
      name: body?.name,
      volumePercent: body?.volumePercent,
      audioSettings: body?.audioSettings,
    });
  }

  @Post(':soundEffectId/presets')
  async saveAsPreset(
    @Req() req: Request,
    @Param('soundEffectId') soundEffectId: string,
    @Body() body: SaveSoundEffectPresetDto,
  ) {
    const user = (req as any).user;
    const user_id = user?.id;
    if (!user_id) throw new UnauthorizedException('User not found in request');

    return this.service.saveAsPreset({
      user_id,
      soundEffectId,
      name: body?.name,
      volumePercent: body?.volumePercent,
      audioSettings: body?.audioSettings,
    });
  }

  @Delete(':soundEffectId')
  async remove(
    @Req() req: Request,
    @Param('soundEffectId') soundEffectId: string,
  ) {
    const user = (req as any).user;
    const user_id = user?.id;
    if (!user_id) throw new UnauthorizedException('User not found in request');

    const deletedId = await this.service.deleteById({ user_id, soundEffectId });
    return { id: deletedId };
  }

  @Post('merge')
  async merge(@Req() req: Request, @Body() body: MergeSoundEffectsDto) {
    const user = (req as any).user;
    const user_id = user?.id;
    if (!user_id) throw new UnauthorizedException('User not found in request');

    return this.service.mergeAndCreate({
      user_id,
      title: body?.title,
      items: body?.items,
    });
  }
}
