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
import { CreateImageFilterDto } from './dto/create-image-filter.dto';
import { UpdateImageFilterDto } from './dto/update-image-filter.dto';
import { ImageFiltersService } from './image-filters.service';

@Controller('image-filters')
export class ImageFiltersController {
  constructor(private readonly service: ImageFiltersService) {}

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
  async create(@Req() req: Request, @Body() body: CreateImageFilterDto) {
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

  @Patch(':imageFilterId')
  @UseGuards(JwtAuthGuard)
  async update(
    @Req() req: Request,
    @Param('imageFilterId') imageFilterId: string,
    @Body() body: UpdateImageFilterDto,
  ) {
    const user_id = (req as any).user?.id;
    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.service.updateById({
      user_id,
      imageFilterId,
      title: body.title,
      settings: body.settings,
    });
  }

  @Delete(':imageFilterId')
  @UseGuards(JwtAuthGuard)
  async remove(
    @Req() req: Request,
    @Param('imageFilterId') imageFilterId: string,
  ) {
    const user_id = (req as any).user?.id;
    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return {
      id: await this.service.deleteById({ user_id, imageFilterId }),
    };
  }
}
