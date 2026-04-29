import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Image } from '../../images/entities/image.entity';
import { Voice } from '../../voices/entities/voice.entity';
import { Video } from '../../videos/entities/video.entity';
import { Script } from '../../scripts/entities/script.entity';
import { ScriptTemplate } from '../../scripts/entities/script-template.entity';
import { BackgroundSoundtrack } from '../../background-soundtracks/entities/background-soundtrack.entity';
import { ImageFilter } from '../../image-filters/entities/image-filter.entity';
import { MotionEffect } from '../../motion-effects/entities/motion-effect.entity';
import { VoiceOver } from '../../voice-overs/entities/voice-over.entity';
import type {
  UserMetaAccountSection,
  UserTikTokAccountSection,
  UserYoutubeAccountSection,
} from './social-account-storage.types';

const EMPTY_SOCIAL_ACCOUNT_SECTION_JSON =
  "'{\"version\":1,\"defaultAccountId\":null,\"accounts\":[]}'::jsonb";

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255, nullable: false, unique: true })
  email!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  password!: string | null;

  @Column({ type: 'int', default: 0 })
  number_of_videos_generated!: number;

  @Column({ type: 'int', default: 0 })
  number_of_images_generated!: number;

  @Column({ type: 'int', default: 0 })
  number_of_voices_generated!: number;

  @Column({ type: 'simple-array', nullable: true })
  roles!: string[];

  @Column({ type: 'varchar', length: 255, nullable: true })
  google_subject!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  google_connected_at!: Date | null;

  @Column({
    type: 'jsonb',
    nullable: false,
    default: () => EMPTY_SOCIAL_ACCOUNT_SECTION_JSON,
  })
  youtube_accounts!: UserYoutubeAccountSection;

  @Column({
    type: 'jsonb',
    nullable: false,
    default: () => EMPTY_SOCIAL_ACCOUNT_SECTION_JSON,
  })
  meta_accounts!: UserMetaAccountSection;

  @Column({
    type: 'jsonb',
    nullable: false,
    default: () => EMPTY_SOCIAL_ACCOUNT_SECTION_JSON,
  })
  tiktok_accounts!: UserTikTokAccountSection;

  @Column({ type: 'text', nullable: true })
  youtube_access_token!: string | null;

  @Column({ type: 'text', nullable: true })
  youtube_refresh_token!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  youtube_token_expiry!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  youtube_connected_at!: Date | null;

  @Column({ type: 'text', nullable: true })
  tiktok_access_token!: string | null;

  @Column({ type: 'text', nullable: true })
  tiktok_refresh_token!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  tiktok_token_expiry!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  tiktok_refresh_token_expiry!: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  tiktok_open_id!: string | null;

  @Column({ type: 'text', nullable: true })
  tiktok_scope!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  tiktok_connected_at!: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  tiktok_oauth_state!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  tiktok_code_verifier!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  tiktok_oauth_started_at!: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at!: Date;

  @OneToMany(() => Image, (image) => image.user)
  images!: Image[];

  @OneToMany(() => Voice, (voice) => voice.user)
  voices!: Voice[];

  @OneToMany(() => Video, (video) => video.user)
  videos!: Video[];

  @OneToMany(() => Script, (script) => script.user)
  scripts!: Script[];

  @OneToMany(() => ScriptTemplate, (template) => template.user)
  script_templates!: ScriptTemplate[];

  @OneToMany(() => BackgroundSoundtrack, (soundtrack) => soundtrack.user)
  background_soundtracks!: BackgroundSoundtrack[];

  @OneToMany(() => ImageFilter, (imageFilter) => imageFilter.user)
  image_filters!: ImageFilter[];

  @OneToMany(() => MotionEffect, (motionEffect) => motionEffect.user)
  motion_effects!: MotionEffect[];

  @OneToMany(() => VoiceOver, (voiceOver) => voiceOver.user)
  voice_overs!: VoiceOver[];
}
