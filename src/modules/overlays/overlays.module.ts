import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SoundEffect } from '../sound-effects/entities/sound-effect.entity';
import { UploadsModule } from '../uploads/uploads.module';
import { Overlay } from './entities/overlay.entity';
import { OverlaysController } from './overlays.controller';
import { OverlaysService } from './overlays.service';

@Module({
  imports: [TypeOrmModule.forFeature([Overlay, SoundEffect]), UploadsModule],
  controllers: [OverlaysController],
  providers: [OverlaysService],
  exports: [OverlaysService],
})
export class OverlaysModule {}
