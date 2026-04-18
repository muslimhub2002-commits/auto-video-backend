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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateOverlayDto } from './dto/create-overlay.dto';
import { UpdateOverlayDto } from './dto/update-overlay.dto';
import { OverlaysService } from './overlays.service';

type UploadedOverlayFile = {
  buffer: Buffer;
  mimetype?: string;
  originalname?: string;
};

@Controller('overlays')
export class OverlaysController {
  constructor(private readonly service: OverlaysService) {}

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
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 50 * 1024 * 1024,
      },
    }),
  )
  async create(
    @Req() req: Request,
    @Body() body: CreateOverlayDto,
    @UploadedFile() file?: UploadedOverlayFile,
  ) {
    const user_id = (req as any).user?.id;
    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.service.createForUser({
      user_id,
      title: body.title,
      settings: body.settings,
      sourceUrl: body.sourceUrl,
      sound_effects: body.sound_effects,
      file,
    });
  }

  @Patch(':overlayId')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 50 * 1024 * 1024,
      },
    }),
  )
  async update(
    @Req() req: Request,
    @Param('overlayId') overlayId: string,
    @Body() body: UpdateOverlayDto,
    @UploadedFile() file?: UploadedOverlayFile,
  ) {
    const user_id = (req as any).user?.id;
    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.service.updateById({
      user_id,
      overlayId,
      title: body.title,
      settings: body.settings,
      sourceUrl: body.sourceUrl,
      sound_effects: body.sound_effects,
      file,
    });
  }

  @Delete(':overlayId')
  @UseGuards(JwtAuthGuard)
  async remove(@Req() req: Request, @Param('overlayId') overlayId: string) {
    const user_id = (req as any).user?.id;
    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return {
      id: await this.service.deleteById({ user_id, overlayId }),
    };
  }
}