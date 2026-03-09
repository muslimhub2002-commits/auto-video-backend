import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImageFiltersController } from './image-filters.controller';
import { ImageFiltersService } from './image-filters.service';
import { ImageFilter } from './entities/image-filter.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ImageFilter])],
  controllers: [ImageFiltersController],
  providers: [ImageFiltersService],
  exports: [ImageFiltersService],
})
export class ImageFiltersModule {}