import {
  ConflictException,
  Controller,
  Delete,
  Get,
  Post,
  Body,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  Param,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VideosLibraryService } from './videos-library.service';
import { CreateVideoUrlDto } from './dto/create-video-url.dto';

@Controller('videos-library')
export class VideosLibraryController {
  constructor(private readonly videosLibraryService: VideosLibraryService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(
    @Req() req: Request,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
    @Query('q') q?: string,
    @Query('orientation') orientation?: string,
  ) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    const pageNum = Number.parseInt(page, 10) || 1;
    const limitNum = Number.parseInt(limit, 10) || 20;

    return this.videosLibraryService.findAllByUser(user_id, pageNum, limitNum, {
      query: q,
      orientation,
    });
  }

  @Get('pexels/search')
  @UseGuards(JwtAuthGuard)
  async searchPexels(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
    @Query('q') q: string = '',
    @Query('orientation') orientation?: string,
    @Query('size') size?: string,
    @Query('color') color?: string,
  ) {
    const pageNum = Number.parseInt(page, 10) || 1;
    const limitNum = Number.parseInt(limit, 10) || 20;

    return this.videosLibraryService.searchFreestock({
      page: pageNum,
      limit: limitNum,
      query: q,
      orientation,
      size,
      color,
      provider: 'pexels',
    });
  }

  @Get('pixabay/search')
  @UseGuards(JwtAuthGuard)
  async searchPixabay(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
    @Query('q') q: string = '',
    @Query('orientation') orientation?: string,
    @Query('size') size?: string,
    @Query('color') color?: string,
  ) {
    const pageNum = Number.parseInt(page, 10) || 1;
    const limitNum = Number.parseInt(limit, 10) || 20;

    return this.videosLibraryService.searchFreestock({
      page: pageNum,
      limit: limitNum,
      query: q,
      orientation,
      size,
      color,
      provider: 'pixabay',
    });
  }

  @Post('pexels/import')
  @UseGuards(JwtAuthGuard)
  async importFromPexels(@Body() body: any, @Req() req: Request) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.videosLibraryService.importFreestockVideo(user_id, body);
  }

  @Post('pixabay/import')
  @UseGuards(JwtAuthGuard)
  async importFromPixabay(@Body() body: any, @Req() req: Request) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.videosLibraryService.importFreestockVideo(user_id, body);
  }

  @Post('url')
  @UseGuards(JwtAuthGuard)
  async createFromUrl(@Body() body: CreateVideoUrlDto, @Req() req: Request) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.videosLibraryService.createFromUrl({
      videoUrl: body.video,
      user_id,
      video_type: body.video_type,
      video_size: body.video_size,
      width: body.width,
      height: body.height,
    });
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async deleteOne(
    @Param('id') id: string,
    @Req() req: Request,
    @Query('force') force?: string,
  ) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    try {
      return await this.videosLibraryService.deleteById(
        user_id,
        id,
        force === 'true',
      );
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw error;
    }
  }
}
