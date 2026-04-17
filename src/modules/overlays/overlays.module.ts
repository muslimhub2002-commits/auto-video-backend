import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UploadsModule } from '../uploads/uploads.module';
import { Overlay } from './entities/overlay.entity';
import { OverlaysController } from './overlays.controller';
import { OverlaysService } from './overlays.service';

@Module({
  imports: [TypeOrmModule.forFeature([Overlay]), UploadsModule],
  controllers: [OverlaysController],
  providers: [OverlaysService],
  exports: [OverlaysService],
})
export class OverlaysModule {}