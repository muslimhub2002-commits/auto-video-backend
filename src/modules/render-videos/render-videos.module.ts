import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RenderJob } from './entities/render-job.entity';
import { RenderVideosController } from './render-videos.controller';
import { RenderVideosService } from './render-videos.service';

@Module({
  imports: [TypeOrmModule.forFeature([RenderJob])],
  controllers: [RenderVideosController],
  providers: [RenderVideosService],
  exports: [RenderVideosService],
})
export class RenderVideosModule {}
