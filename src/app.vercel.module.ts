import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from './modules/auth/auth.module';
import { AiModule } from './modules/ai/ai.module';
import { VoiceOversModule } from './modules/voice-overs/voice-overs.module';
import { ImagesModule } from './modules/images/images.module';
import { VoicesModule } from './modules/voices/voices.module';
import { ImageFiltersModule } from './modules/image-filters/image-filters.module';
import { MotionEffectsModule } from './modules/motion-effects/motion-effects.module';
import { TextAnimationsModule } from './modules/text-animations/text-animations.module';
import { BackgroundSoundtracksModule } from './modules/background-soundtracks/background-soundtracks.module';
import { SoundEffectsModule } from './modules/sound-effects/sound-effects.module';
import { ScriptsModule } from './modules/scripts/scripts.module';
import { YoutubeModule } from './modules/youtube/youtube.module';
import { MetaModule } from './modules/meta/meta.module';
import { TiktokModule } from './modules/tiktok/tiktok.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { SocialAccountsModule } from './modules/social-accounts/social-accounts.module';

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
    UploadsModule,
    AiModule,
    VoiceOversModule,
    ImagesModule,
    VoicesModule,
    ImageFiltersModule,
    MotionEffectsModule,
    TextAnimationsModule,
    BackgroundSoundtracksModule,
    SoundEffectsModule,
    ScriptsModule,
    SocialAccountsModule,
    YoutubeModule,
    MetaModule,
    TiktokModule,
  ],
})
export class AppVercelModule {}
