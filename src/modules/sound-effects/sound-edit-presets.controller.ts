import {
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
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateSoundEditPresetDto } from './dto/create-sound-edit-preset.dto';
import { UpdateSoundEditPresetDto } from './dto/update-sound-edit-preset.dto';
import { SoundEditPresetsService } from './sound-edit-presets.service';

@Controller('sound-edit-presets')
@UseGuards(JwtAuthGuard)
export class SoundEditPresetsController {
  constructor(private readonly service: SoundEditPresetsService) {}

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
    void limit;
    return this.service.findAllByUser(user_id, pageNum, 20, q);
  }

  @Post()
  async create(@Req() req: Request, @Body() body: CreateSoundEditPresetDto) {
    const user = (req as any).user;
    const user_id = user?.id;
    if (!user_id) throw new UnauthorizedException('User not found in request');

    return this.service.create(user_id, body);
  }

  @Patch(':presetId')
  async update(
    @Req() req: Request,
    @Param('presetId') presetId: string,
    @Body() body: UpdateSoundEditPresetDto,
  ) {
    const user = (req as any).user;
    const user_id = user?.id;
    if (!user_id) throw new UnauthorizedException('User not found in request');

    return this.service.update({
      user_id,
      presetId,
      dto: body,
    });
  }

  @Delete(':presetId')
  async remove(@Req() req: Request, @Param('presetId') presetId: string) {
    const user = (req as any).user;
    const user_id = user?.id;
    if (!user_id) throw new UnauthorizedException('User not found in request');

    return this.service.remove({ user_id, presetId });
  }
}
