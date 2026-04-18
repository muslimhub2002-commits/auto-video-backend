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
import { CreateTextAnimationDto } from './dto/create-text-animation.dto';
import { UpdateTextAnimationDto } from './dto/update-text-animation.dto';
import { TextAnimationsService } from './text-animations.service';

@Controller('text-animations')
export class TextAnimationsController {
  constructor(private readonly service: TextAnimationsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(
    @Req() req: Request,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
    @Query('q') q?: string,
  ) {
    const user_id = (req as any).user?.id;
    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.service.findAllByUser(
      user_id,
      Number.parseInt(page, 10) || 1,
      Number.parseInt(limit, 10) || 50,
      q,
    );
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@Req() req: Request, @Body() body: CreateTextAnimationDto) {
    const user_id = (req as any).user?.id;
    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.service.createForUser({
      user_id,
      title: body.title,
      settings: body.settings,
      sound_effects: body.sound_effects,
    });
  }

  @Patch(':textAnimationId')
  @UseGuards(JwtAuthGuard)
  async update(
    @Req() req: Request,
    @Param('textAnimationId') textAnimationId: string,
    @Body() body: UpdateTextAnimationDto,
  ) {
    const user_id = (req as any).user?.id;
    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.service.updateById({
      user_id,
      textAnimationId,
      title: body.title,
      settings: body.settings,
      sound_effects: body.sound_effects,
    });
  }

  @Delete(':textAnimationId')
  @UseGuards(JwtAuthGuard)
  async remove(
    @Req() req: Request,
    @Param('textAnimationId') textAnimationId: string,
  ) {
    const user_id = (req as any).user?.id;
    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return {
      id: await this.service.deleteById({ user_id, textAnimationId }),
    };
  }
}
