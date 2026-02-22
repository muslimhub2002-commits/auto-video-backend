import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BackgroundSoundtracksController } from './background-soundtracks.controller';
import { BackgroundSoundtracksService } from './background-soundtracks.service';
import { BackgroundSoundtrack } from './entities/background-soundtrack.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BackgroundSoundtrack])],
  controllers: [BackgroundSoundtracksController],
  providers: [BackgroundSoundtracksService],
  exports: [BackgroundSoundtracksService],
})
export class BackgroundSoundtracksModule {}
