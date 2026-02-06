import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VoiceOver } from './entities/voice-over.entity';
import { VoiceOversService } from './voice-overs.service';
import { VoiceOversController } from './voice-overs.controller';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [TypeOrmModule.forFeature([VoiceOver]), AiModule],
  controllers: [VoiceOversController],
  providers: [VoiceOversService],
  exports: [VoiceOversService],
})
export class VoiceOversModule {}
