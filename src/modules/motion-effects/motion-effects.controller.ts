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
import { CreateMotionEffectDto } from './dto/create-motion-effect.dto';
import { UpdateMotionEffectDto } from './dto/update-motion-effect.dto';
import { MotionEffectsService } from './motion-effects.service';

@Controller('motion-effects')
export class MotionEffectsController {
  constructor(private readonly service: MotionEffectsService) {}

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
  async create(@Req() req: Request, @Body() body: CreateMotionEffectDto) {
    const user_id = (req as any).user?.id;
    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.service.createForUser({
      user_id,
      title: body.title,
      settings: body.settings,
    });
  }

  @Patch(':motionEffectId')
  @UseGuards(JwtAuthGuard)
  async update(
    @Req() req: Request,
    @Param('motionEffectId') motionEffectId: string,
    @Body() body: UpdateMotionEffectDto,
  ) {
    const user_id = (req as any).user?.id;
    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.service.updateById({
      user_id,
      motionEffectId,
      title: body.title,
      settings: body.settings,
    });
  }

  @Delete(':motionEffectId')
  @UseGuards(JwtAuthGuard)
  async remove(
    @Req() req: Request,
    @Param('motionEffectId') motionEffectId: string,
  ) {
    const user_id = (req as any).user?.id;
    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return {
      id: await this.service.deleteById({ user_id, motionEffectId }),
    };
  }
}