import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Script } from './script.entity';
import { Image } from '../../images/entities/image.entity';
import { Video } from '../../videos/entities/video.entity';
import { Overlay } from '../../overlays/entities/overlay.entity';
import { SentenceSoundEffect } from './sentence-sound-effect.entity';

@Entity('sentences')
export class Sentence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', nullable: false })
  text: string;

  @Column({ type: 'int', nullable: false })
  index: number;

  @Column({ type: 'uuid', nullable: false })
  script_id: string;

  @Column({ type: 'uuid', nullable: true })
  image_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  secondary_image_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  start_frame_image_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  end_frame_image_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  video_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  text_background_image_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  text_background_video_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  overlay_id: string | null;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  voice_over_url: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  voice_over_mime_type: string | null;

  @Column({ type: 'real', nullable: true })
  voice_over_duration_seconds: number | null;

  @Column({ type: 'text', nullable: true })
  voice_over_provider: string | null;

  @Column({ type: 'text', nullable: true })
  voice_over_voice_id: string | null;

  @Column({ type: 'text', nullable: true })
  voice_over_voice_name: string | null;

  @Column({ type: 'text', nullable: true })
  voice_over_style_instructions: string | null;

  @Column({ type: 'jsonb', nullable: true })
  eleven_labs_settings: {
    stability?: number | null;
    similarityBoost?: number | null;
    style?: number | null;
    speed?: number | null;
    useSpeakerBoost?: boolean | null;
  } | null;

  // Optional per-sentence video prompt (used for AI video generation modes).
  @Column({ type: 'text', nullable: true })
  video_prompt: string | null;

  @Column({ type: 'boolean', default: false })
  align_sound_effects_to_scene_end: boolean;

  // Optional per-sentence override for the cut/transition to the next sentence.
  // Null means auto-selection by the renderer.
  @Column({ type: 'text', nullable: true })
  transition_to_next: string | null;

  // Optional per-sentence visual effect applied on the media itself.
  // Null means no effect.
  @Column({ type: 'text', nullable: true })
  visual_effect: string | null;

  // Optional per-sentence image motion preset.
  // Null means legacy/default behavior.
  @Column({ type: 'text', nullable: true })
  image_motion_effect: string | null;

  @Column({ type: 'real', nullable: true })
  image_motion_speed: number | null;

  @Column({ type: 'text', nullable: true })
  image_effects_mode: string | null;

  @Column({ type: 'text', nullable: true })
  scene_tab: string | null;

  @Column({ type: 'uuid', nullable: true })
  image_filter_id: string | null;

  @Column({ type: 'jsonb', nullable: true })
  image_filter_settings: Record<string, unknown> | null;

  @Column({ type: 'uuid', nullable: true })
  motion_effect_id: string | null;

  @Column({ type: 'jsonb', nullable: true })
  image_motion_settings: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  text_animation_text: string | null;

  @Column({ type: 'text', nullable: true })
  text_animation_effect: string | null;

  @Column({ type: 'uuid', nullable: true })
  text_animation_id: string | null;

  @Column({ type: 'jsonb', nullable: true })
  text_animation_settings: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  text_animation_sound_effects: Array<{
    sound_effect_id: string;
    title?: string;
    url?: string;
    delay_seconds?: number;
    volume_percent?: number;
    timing_mode?: 'with_previous' | 'after_previous_ends';
    audio_settings_override?: Record<string, unknown> | null;
    default_audio_settings?: Record<string, unknown> | null;
    duration_seconds?: number | null;
  }> | null;

  @Column({ type: 'jsonb', nullable: true })
  overlay_settings: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  overlay_sound_effects: Array<{
    sound_effect_id: string;
    title?: string;
    url?: string;
    delay_seconds?: number;
    volume_percent?: number;
    timing_mode?: 'with_previous' | 'after_previous_ends';
    audio_settings_override?: Record<string, unknown> | null;
    default_audio_settings?: Record<string, unknown> | null;
    duration_seconds?: number | null;
  }> | null;

  // Optional per-cut custom transition sounds for the cut from this sentence
  // into the next one. Stored inline so unsaved multi-sound mixes can round-trip.
  @Column({ type: 'jsonb', nullable: true })
  transition_sound_effects: Array<{
    sound_effect_id: string;
    title?: string;
    url?: string;
    delay_seconds?: number;
    volume_percent?: number;
  }> | null;

  @Column({ type: 'boolean', default: false })
  isSuspense: boolean;

  // Optional per-sentence override: if present, the image prompt should reference
  // exactly these canonical character keys and skip mention/detection logic.
  @Column({ type: 'jsonb', nullable: true })
  forced_character_keys: string[] | null;

  // Canonical character keys inferred during splitting (non-forced).
  @Column({ type: 'jsonb', nullable: true })
  character_keys: string[] | null;

  // Canonical location key inferred during splitting (non-forced).
  @Column({ type: 'text', nullable: true })
  location_key: string | null;

  // Optional per-sentence override for location selection.
  @Column({ type: 'text', nullable: true })
  forced_location_key: string | null;

  @ManyToOne(() => Script, (script) => script.sentences, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'script_id' })
  script: Script;

  @ManyToOne(() => Image, { nullable: true })
  @JoinColumn({ name: 'image_id' })
  image: Image | null;

  @ManyToOne(() => Image, { nullable: true })
  @JoinColumn({ name: 'secondary_image_id' })
  secondaryImage: Image | null;

  @ManyToOne(() => Image, { nullable: true })
  @JoinColumn({ name: 'start_frame_image_id' })
  startFrameImage: Image | null;

  @ManyToOne(() => Image, { nullable: true })
  @JoinColumn({ name: 'end_frame_image_id' })
  endFrameImage: Image | null;

  @ManyToOne(() => Video, { nullable: true })
  @JoinColumn({ name: 'video_id' })
  video: Video | null;

  @ManyToOne(() => Image, { nullable: true })
  @JoinColumn({ name: 'text_background_image_id' })
  textBackgroundImage: Image | null;

  @ManyToOne(() => Video, { nullable: true })
  @JoinColumn({ name: 'text_background_video_id' })
  textBackgroundVideo: Video | null;

  @ManyToOne(() => Overlay, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'overlay_id' })
  overlay: Overlay | null;

  @OneToMany(
    () => SentenceSoundEffect,
    (sentenceSoundEffect) => sentenceSoundEffect.sentence,
  )
  sound_effects: SentenceSoundEffect[];
}
