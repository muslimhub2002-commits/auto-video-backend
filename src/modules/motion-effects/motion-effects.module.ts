import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MotionEffectsController } from './motion-effects.controller';
import { MotionEffectsService } from './motion-effects.service';
import { MotionEffect } from './entities/motion-effect.entity';

@Module({
  imports: [TypeOrmModule.forFeature([MotionEffect])],
  controllers: [MotionEffectsController],
  providers: [MotionEffectsService],
  exports: [MotionEffectsService],
})
export class MotionEffectsModule {}
