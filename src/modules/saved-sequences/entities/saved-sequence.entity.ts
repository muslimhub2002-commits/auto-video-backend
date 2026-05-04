import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  SAVED_SEQUENCE_IMAGE_EFFECTS_MODES,
  SAVED_SEQUENCE_IMAGE_MOTION_EFFECTS,
  SAVED_SEQUENCE_SCENE_TABS,
  SAVED_SEQUENCE_TEXT_ANIMATION_EFFECTS,
  SAVED_SEQUENCE_TRANSITIONS,
  SAVED_SEQUENCE_VIDEO_GENERATION_MODES,
  SAVED_SEQUENCE_VISUAL_EFFECTS,
} from '../saved-sequence.constants';
import { User } from '../../users/entities/user.entity';

export type SavedSequenceSceneTab =
  (typeof SAVED_SEQUENCE_SCENE_TABS)[number];
export type SavedSequenceImageEffectsMode =
  (typeof SAVED_SEQUENCE_IMAGE_EFFECTS_MODES)[number];
export type SavedSequenceTransition =
  (typeof SAVED_SEQUENCE_TRANSITIONS)[number];
export type SavedSequenceVisualEffect =
  (typeof SAVED_SEQUENCE_VISUAL_EFFECTS)[number];
export type SavedSequenceImageMotionEffect =
  (typeof SAVED_SEQUENCE_IMAGE_MOTION_EFFECTS)[number];
export type SavedSequenceTextAnimationEffect =
  (typeof SAVED_SEQUENCE_TEXT_ANIMATION_EFFECTS)[number];
export type SavedSequenceVideoGenerationMode =
  (typeof SAVED_SEQUENCE_VIDEO_GENERATION_MODES)[number];
export type SavedSequenceTimingMode =
  | 'with_previous'
  | 'after_previous_ends';

export type SavedSequenceSoundEffectSnapshot = {
  sound_effect_id: string;
  title?: string;
  url?: string;
  delay_seconds?: number;
  volume_percent?: number;
  timing_mode?: SavedSequenceTimingMode;
  audio_settings?: Record<string, unknown> | null;
  default_audio_settings?: Record<string, unknown> | null;
  duration_seconds?: number | null;
};

export type SavedSequenceTransitionSoundEffectSnapshot = {
  sound_effect_id: string;
  title?: string;
  url?: string;
  delay_seconds?: number;
  volume_percent?: number;
  audio_settings?: Record<string, unknown> | null;
};

export type SavedSequenceSceneSnapshot = {
  scene_tab: SavedSequenceSceneTab;
  image_effects_mode?: SavedSequenceImageEffectsMode | null;
  align_sound_effects_to_scene_end?: boolean;
  visual_effect?: SavedSequenceVisualEffect | null;
  custom_image_filter_id?: string | null;
  image_filter_settings?: Record<string, unknown> | null;
  image_motion_effect?: SavedSequenceImageMotionEffect | null;
  custom_motion_effect_id?: string | null;
  image_motion_settings?: Record<string, unknown> | null;
  image_motion_speed?: number | null;
  video_generation_mode?: SavedSequenceVideoGenerationMode | null;
  text_animation_effect?: SavedSequenceTextAnimationEffect | null;
  text_animation_settings?: Record<string, unknown> | null;
  text_animation_sound_effects?: SavedSequenceSoundEffectSnapshot[] | null;
  overlay_url?: string | null;
  overlay_mime_type?: string | null;
  overlay_settings?: Record<string, unknown> | null;
  overlay_sound_effects?: SavedSequenceSoundEffectSnapshot[] | null;
  sound_effects?: SavedSequenceSoundEffectSnapshot[] | null;
  transition_to_next?: SavedSequenceTransition | null;
  transition_sound_effects?: SavedSequenceTransitionSoundEffectSnapshot[] | null;
  is_suspense?: boolean;
};

@Entity('saved-sequences')
export class SavedSequence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: false })
  user_id: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  title: string;

  @Column({ type: 'jsonb', nullable: false, default: () => "'[]'::jsonb" })
  scenes: SavedSequenceSceneSnapshot[];

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}