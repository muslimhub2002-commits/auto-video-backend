import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { YoutubeController } from './youtube.controller';
import { YoutubeService } from './youtube.service';
import { User } from '../users/entities/user.entity';
import { MessagesModule } from '../messages/messages.module';
import { ScriptsModule } from '../scripts/scripts.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), MessagesModule, ScriptsModule],
  controllers: [YoutubeController],
  providers: [YoutubeService],
  exports: [YoutubeService],
})
export class YoutubeModule {}
