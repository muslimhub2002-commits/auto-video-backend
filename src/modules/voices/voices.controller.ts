import {
  Controller,
  Get,
  Post,
  Body,
  UseInterceptors,
  UploadedFile,
  Req,
  UseGuards,
  UnauthorizedException,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { VoicesService } from './voices.service';
import { CreateVoiceDto } from './dto/create-voice.dto';
import { CreateVoiceUrlDto } from './dto/create-voice-url.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('voices')
export class VoicesController {
  constructor(private readonly voicesService: VoicesService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(
    @Req() req: Request,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    const pageNum = Number.parseInt(page, 10) || 1;
    const limitNum = Number.parseInt(limit, 10) || 20;

    return this.voicesService.findAllByUser(user_id, pageNum, limitNum);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('voice', {
      // Vercel serverless has small request limits; keep this conservative.
      limits: { fileSize: 4 * 1024 * 1024 },
    }),
  )
  async create(
    @UploadedFile() file: any,
    @Body() body: Omit<CreateVoiceDto, 'voice' | 'user_id'>,
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    if (!file?.buffer) {
      throw new BadRequestException(
        'No voice file uploaded. If deploying on Vercel, prefer POST /voices/url (upload directly to Cloudinary from the client).',
      );
    }

    const mimetype = String(file?.mimetype ?? '');
    if (mimetype && !mimetype.startsWith('audio/')) {
      throw new BadRequestException(
        `Invalid file type for voice upload: ${mimetype}. Expected an audio/* mime type.`,
      );
    }

    const voice = await this.voicesService.saveToCloudinary({
      buffer: file.buffer,
      filename: file.originalname,
      user_id,
      voice_type: body.voice_type,
      voice_lang: body.voice_lang,
    });

    return voice;
  }

  @Post('url')
  @UseGuards(JwtAuthGuard)
  async createFromUrl(@Body() body: CreateVoiceUrlDto, @Req() req: Request) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.voicesService.createFromUrl({
      voiceUrl: body.voice,
      user_id,
      voice_type: body.voice_type,
      voice_lang: body.voice_lang,
      hash: body.hash,
    });
  }
}
