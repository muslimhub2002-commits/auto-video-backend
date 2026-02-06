import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  Query,
} from '@nestjs/common';
import { VoiceOversService } from './voice-overs.service';
import { VoiceOver } from './entities/voice-over.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('voice-overs')
export class VoiceOversController {
  constructor(private readonly voiceOversService: VoiceOversService) {}

  @Get()
  async findAll(@Query('provider') provider?: string): Promise<VoiceOver[]> {
    return this.voiceOversService.findAll({ provider });
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  async sync(
    @Query('provider') provider?: string,
  ): Promise<{ imported: number; updated: number }> {
    return this.voiceOversService.syncAll({ provider });
  }

  @Patch('favorite/:voiceId')
  @UseGuards(JwtAuthGuard)
  async setFavorite(@Param('voiceId') voiceId: string): Promise<VoiceOver> {
    return this.voiceOversService.setFavoriteByVoiceId(voiceId);
  }

  // Generates and caches an AI Studio (Gemini TTS) preview sample.
  // If preview_url already exists, returns it without re-generating.
  @Post('preview/:voiceId')
  @HttpCode(HttpStatus.OK)
  async getOrCreatePreview(
    @Param('voiceId') voiceId: string,
  ): Promise<{ preview_url: string }> {
    return this.voiceOversService.getOrCreatePreviewUrl(voiceId);
  }
}
