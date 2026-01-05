import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { User } from './modules/users/entities/user.entity';
import { Image } from './modules/images/entities/image.entity';
import { Voice } from './modules/voices/entities/voice.entity';
import { VoiceOver } from './modules/voice-overs/entities/voice-over.entity';
import { Video } from './modules/videos/entities/video.entity';
import { Chat } from './modules/chats/entities/chat.entity';
import { Message } from './modules/messages/entities/message.entity';
import { Script } from './modules/scripts/entities/script.entity';
import { Sentence } from './modules/scripts/entities/sentence.entity';
import { AiModule } from './modules/ai/ai.module';
import { RenderVideosModule } from './modules/render-videos/render-videos.module';
import { VoiceOversModule } from './modules/voice-overs/voice-overs.module';
import { ImagesModule } from './modules/images/images.module';
import { VoicesModule } from './modules/voices/voices.module';
import { ScriptsModule } from './modules/scripts/scripts.module';
import { MessagesModule } from './modules/messages/messages.module';
import { ChatsModule } from './modules/chats/chats.module';
import { RenderJob } from './modules/render-videos/entities/render-job.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      autoLoadEntities: true,
      synchronize: false,
      ssl: { rejectUnauthorized: false },
      extra: {
        max: 5,
      },
      // Explicitly register all entities so relations like User#images are recognized
      entities: [
        User,
        Image,
        Voice,
        VoiceOver,
        Video,
        Chat,
        Message,
        RenderJob,
        Script,
        Sentence,
      ],
    }),

    AuthModule,
    AiModule,
    RenderVideosModule,
    VoiceOversModule,
    ImagesModule,
    VoicesModule,
    ScriptsModule,
    MessagesModule,
    ChatsModule,
  ],
})
export class AppModule { }
