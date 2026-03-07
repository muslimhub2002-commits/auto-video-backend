import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SoundEffectsController } from './sound-effects.controller';
import { SoundEffectsService } from './sound-effects.service';
import { SoundEffect } from './entities/sound-effect.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SoundEffect])],
  controllers: [SoundEffectsController],
  providers: [SoundEffectsService],
  exports: [SoundEffectsService, TypeOrmModule],
})
export class SoundEffectsModule {}
