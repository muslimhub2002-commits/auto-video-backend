import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SoundEffectsController } from './sound-effects.controller';
import { SoundEffectsService } from './sound-effects.service';
import { SoundEffect } from './entities/sound-effect.entity';
import { SoundEditPreset } from './entities/sound-edit-preset.entity';
import { SoundEditPresetsController } from './sound-edit-presets.controller';
import { SoundEditPresetsService } from './sound-edit-presets.service';

@Module({
  imports: [TypeOrmModule.forFeature([SoundEffect, SoundEditPreset])],
  controllers: [SoundEffectsController, SoundEditPresetsController],
  providers: [SoundEffectsService, SoundEditPresetsService],
  exports: [SoundEffectsService, SoundEditPresetsService, TypeOrmModule],
})
export class SoundEffectsModule {}
