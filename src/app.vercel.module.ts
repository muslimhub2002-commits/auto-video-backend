import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from './modules/auth/auth.module';
import { AiModule } from './modules/ai/ai.module';
import { VoiceOversModule } from './modules/voice-overs/voice-overs.module';
import { ImagesModule } from './modules/images/images.module';
import { VoicesModule } from './modules/voices/voices.module';
import { BackgroundSoundtracksModule } from './modules/background-soundtracks/background-soundtracks.module';
import { ScriptsModule } from './modules/scripts/scripts.module';
import { MessagesModule } from './modules/messages/messages.module';
import { ChatsModule } from './modules/chats/chats.module';
import { YoutubeModule } from './modules/youtube/youtube.module';

/**
 * Vercel deployment module.
 *
 * Intentionally excludes the RenderVideos module (Remotion/Chromium heavy)
 * so Vercel Serverless Function bundle stays under the 250MB unzipped limit.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      autoLoadEntities: true,
      synchronize: true,
      ssl:
        process.env.DB_SSL === 'true'
          ? { rejectUnauthorized: false }
          : process.env.DB_SSL === 'false'
            ? false
            : process.env.NODE_ENV === 'production'
              ? { rejectUnauthorized: false }
              : false,
      extra: { max: 5 },
    }),

    AuthModule,
    AiModule,
    VoiceOversModule,
    ImagesModule,
    VoicesModule,
    BackgroundSoundtracksModule,
    ScriptsModule,
    MessagesModule,
    ChatsModule,
    YoutubeModule,
  ],
})
export class AppVercelModule {}
