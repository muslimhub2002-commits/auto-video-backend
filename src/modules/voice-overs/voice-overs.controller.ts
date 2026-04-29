import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  UnauthorizedException,
  UseGuards,
  Query,
} from '@nestjs/common';
import type { Request } from 'express';
import { VoiceOversService } from './voice-overs.service';
import { VoiceOver } from './entities/voice-over.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ImportElevenLabsVoiceDto } from './dto/import-elevenlabs-voice.dto';

@Controller('voice-overs')
export class VoiceOversController {
  constructor(private readonly voiceOversService: VoiceOversService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  async findAll(
    @Req() req: Request,
    @Query('provider') provider?: string,
  ): Promise<VoiceOver[]> {
    const user_id = (req as any).user?.id;
    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.voiceOversService.findAll({ user_id, provider });
  }

  @UseGuards(JwtAuthGuard)
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  async sync(
    @Req() req: Request,
    @Query('provider') provider?: string,
  ): Promise<{ imported: number; updated: number }> {
    const user_id = (req as any).user?.id;
    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.voiceOversService.syncAll({ user_id, provider });
  }

  @UseGuards(JwtAuthGuard)
  @Post('elevenlabs/import')
  @HttpCode(HttpStatus.OK)
  async importElevenLabsVoice(
    @Req() req: Request,
    @Body() body: ImportElevenLabsVoiceDto,
  ): Promise<VoiceOver> {
    const user_id = (req as any).user?.id;
    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.voiceOversService.importOneFromElevenLabs(user_id, body.voiceId);
  }

  @Patch('favorite/:voiceId')
  @UseGuards(JwtAuthGuard)
  async setFavorite(
    @Req() req: Request,
    @Param('voiceId') voiceId: string,
  ): Promise<VoiceOver> {
    const user_id = (req as any).user?.id;
    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.voiceOversService.setFavoriteByVoiceId(user_id, voiceId);
  }

  // Generates and caches an AI Studio (Gemini TTS) preview sample.
  // If preview_url already exists, returns it without re-generating.
  @UseGuards(JwtAuthGuard)
  @Post('preview/:voiceId')
  @HttpCode(HttpStatus.OK)
  async getOrCreatePreview(
    @Req() req: Request,
    @Param('voiceId') voiceId: string,
  ): Promise<{ preview_url: string }> {
    const user_id = (req as any).user?.id;
    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.voiceOversService.getOrCreatePreviewUrl(user_id, voiceId);
  }
}
