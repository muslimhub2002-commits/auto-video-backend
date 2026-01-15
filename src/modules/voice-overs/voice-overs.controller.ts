import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { VoiceOversService } from './voice-overs.service';
import { VoiceOver } from './entities/voice-over.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('voice-overs')
export class VoiceOversController {
  constructor(private readonly voiceOversService: VoiceOversService) {}

  @Get()
  async findAll(): Promise<VoiceOver[]> {
    return this.voiceOversService.findAll();
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  async syncFromElevenLabs(): Promise<{ imported: number; updated: number }> {
    return this.voiceOversService.syncAllFromElevenLabs();
  }

  @Patch('favorite/:voiceId')
  @UseGuards(JwtAuthGuard)
  async setFavorite(@Param('voiceId') voiceId: string): Promise<VoiceOver> {
    return this.voiceOversService.setFavoriteByVoiceId(voiceId);
  }
}
