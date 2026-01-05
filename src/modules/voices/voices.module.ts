import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VoicesService } from './voices.service';
import { VoicesController } from './voices.controller';
import { Voice } from './entities/voice.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Voice])],
  providers: [VoicesService],
  controllers: [VoicesController],
  exports: [VoicesService],
})
export class VoicesModule {}
