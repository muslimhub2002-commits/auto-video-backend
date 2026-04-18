import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SoundEffect } from '../sound-effects/entities/sound-effect.entity';
import { TextAnimationsController } from './text-animations.controller';
import { TextAnimationsService } from './text-animations.service';
import { TextAnimation } from './entities/text-animation.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TextAnimation, SoundEffect])],
  controllers: [TextAnimationsController],
  providers: [TextAnimationsService],
  exports: [TextAnimationsService],
})
export class TextAnimationsModule {}
