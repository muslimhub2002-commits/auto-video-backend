import { Controller, Get, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { VoiceOversService } from './voice-overs.service';
import { VoiceOver } from './entities/voice-over.entity';

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
}
