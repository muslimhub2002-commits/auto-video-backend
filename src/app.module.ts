import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './modules/auth/auth.module';
import { User } from './modules/users/entities/user.entity';
import { Image } from './modules/images/entities/image.entity';
import { Voice } from './modules/voices/entities/voice.entity';
import { VoiceOver } from './modules/voice-overs/entities/voice-over.entity';
import { Video } from './modules/videos/entities/video.entity';
import { Script } from './modules/scripts/entities/script.entity';
import { Sentence } from './modules/scripts/entities/sentence.entity';
import { SentenceSoundEffect } from './modules/scripts/entities/sentence-sound-effect.entity';
import { ScriptTemplate } from './modules/scripts/entities/script-template.entity';
import { ScriptTranslationGroup } from './modules/scripts/entities/script-translation-group.entity';
import { AiModule } from './modules/ai/ai.module';
import { RenderVideosModule } from './modules/render-videos/render-videos.module';
import { VoiceOversModule } from './modules/voice-overs/voice-overs.module';
import { ImagesModule } from './modules/images/images.module';
import { VoicesModule } from './modules/voices/voices.module';
import { BackgroundSoundtracksModule } from './modules/background-soundtracks/background-soundtracks.module';
import { ImageFiltersModule } from './modules/image-filters/image-filters.module';
import { MotionEffectsModule } from './modules/motion-effects/motion-effects.module';
import { ScriptsModule } from './modules/scripts/scripts.module';
import { RenderJob } from './modules/render-videos/entities/render-job.entity';
import { YoutubeModule } from './modules/youtube/youtube.module';
import { MetaModule } from './modules/meta/meta.module';
import { TiktokModule } from './modules/tiktok/tiktok.module';
import { MetaCredential } from './modules/meta/entities/meta-credential.entity';
import { BackgroundSoundtrack } from './modules/background-soundtracks/entities/background-soundtrack.entity';
import { ImageFilter } from './modules/image-filters/entities/image-filter.entity';
import { MotionEffect } from './modules/motion-effects/entities/motion-effect.entity';
import { Overlay } from './modules/overlays/entities/overlay.entity';
import { TextAnimation } from './modules/text-animations/entities/text-animation.entity';
import { VideosLibraryModule } from './modules/videos-library/videos-library.module';
import { SoundEffectsModule } from './modules/sound-effects/sound-effects.module';
import { SoundEffect } from './modules/sound-effects/entities/sound-effect.entity';
import { SoundEditPreset } from './modules/sound-effects/entities/sound-edit-preset.entity';
import { TextAnimationsModule } from './modules/text-animations/text-animations.module';
import { OverlaysModule } from './modules/overlays/overlays.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { SocialAccountsModule } from './modules/social-accounts/social-accounts.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),

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
      extra: {
        max: 5,
      },
      // Explicitly register all entities so relations like User#images are recognized
      entities: [
        User,
        Image,
        Voice,
        ImageFilter,
        MotionEffect,
        Overlay,
        TextAnimation,
        BackgroundSoundtrack,
        SoundEffect,
        SoundEditPreset,
        MetaCredential,
        VoiceOver,
        Video,
        RenderJob,
        Script,
        Sentence,
        SentenceSoundEffect,
        ScriptTemplate,
        ScriptTranslationGroup,
      ],
    }),

    AuthModule,
    UploadsModule,
    AiModule,
    RenderVideosModule,
    VideosLibraryModule,
    VoiceOversModule,
    ImagesModule,
    VoicesModule,
    ImageFiltersModule,
    MotionEffectsModule,
    OverlaysModule,
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
export class AppModule {}
