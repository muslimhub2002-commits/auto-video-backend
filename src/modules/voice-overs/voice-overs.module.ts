import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VoiceOver } from './entities/voice-over.entity';
import { VoiceOversService } from './voice-overs.service';
import { VoiceOversController } from './voice-overs.controller';

@Module({
  imports: [TypeOrmModule.forFeature([VoiceOver])],
  controllers: [VoiceOversController],
  providers: [VoiceOversService],
  exports: [VoiceOversService],
})
export class VoiceOversModule {}
