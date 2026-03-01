import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Video } from '../videos/entities/video.entity';
import { VideosLibraryController } from './videos-library.controller';
import { VideosLibraryService } from './videos-library.service';

@Module({
  imports: [TypeOrmModule.forFeature([Video])],
  controllers: [VideosLibraryController],
  providers: [VideosLibraryService],
  exports: [VideosLibraryService],
})
export class VideosLibraryModule {}
