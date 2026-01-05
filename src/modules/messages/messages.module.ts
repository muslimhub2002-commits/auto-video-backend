import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { Chat } from '../chats/entities/chat.entity';
import { Message } from './entities/message.entity';
import { Video } from '../videos/entities/video.entity';
import { AiModule } from '../ai/ai.module';
import { ScriptsModule } from '../scripts/scripts.module';
import { RenderVideosModule } from '../render-videos/render-videos.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Chat, Message, Video]),
    AiModule,
    ScriptsModule,
    RenderVideosModule,
  ],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
