import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { SENTENCE_SOUND_EFFECT_TIMING_MODES } from '../../scripts/entities/sentence-sound-effect.entity';
import {
  SAVED_SEQUENCE_IMAGE_EFFECTS_MODES,
  SAVED_SEQUENCE_IMAGE_MOTION_EFFECTS,
  SAVED_SEQUENCE_SCENE_TABS,
  SAVED_SEQUENCE_TEXT_ANIMATION_EFFECTS,
  SAVED_SEQUENCE_TRANSITIONS,
  SAVED_SEQUENCE_VIDEO_GENERATION_MODES,
  SAVED_SEQUENCE_VISUAL_EFFECTS,
} from '../saved-sequence.constants';

export class SavedSequenceSoundEffectInput {
  @IsUUID()
  sound_effect_id: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  url?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  delay_seconds?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(300)
  @IsOptional()
  volume_percent?: number;

  @IsIn(SENTENCE_SOUND_EFFECT_TIMING_MODES)
  @IsOptional()
  timing_mode?: (typeof SENTENCE_SOUND_EFFECT_TIMING_MODES)[number];

  @IsObject()
  @IsOptional()
  audio_settings?: Record<string, unknown> | null;

  @IsObject()
  @IsOptional()
  default_audio_settings?: Record<string, unknown> | null;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  duration_seconds?: number | null;
}

export class SavedSequenceTransitionSoundEffectInput {
  @IsUUID()
  sound_effect_id: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  url?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  delay_seconds?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(300)
  @IsOptional()
  volume_percent?: number;

  @IsObject()
  @IsOptional()
  audio_settings?: Record<string, unknown> | null;
}

export class SavedSequenceSceneInput {
  @IsIn(SAVED_SEQUENCE_SCENE_TABS)
  scene_tab: (typeof SAVED_SEQUENCE_SCENE_TABS)[number];

  @IsIn(SAVED_SEQUENCE_IMAGE_EFFECTS_MODES)
  @IsOptional()
  image_effects_mode?: (typeof SAVED_SEQUENCE_IMAGE_EFFECTS_MODES)[number] | null;

  @IsBoolean()
  @IsOptional()
  align_sound_effects_to_scene_end?: boolean;

  @IsIn(SAVED_SEQUENCE_VISUAL_EFFECTS)
  @IsOptional()
  visual_effect?: (typeof SAVED_SEQUENCE_VISUAL_EFFECTS)[number] | null;

  @IsUUID()
  @IsOptional()
  custom_image_filter_id?: string | null;

  @IsObject()
  @IsOptional()
  image_filter_settings?: Record<string, unknown> | null;

  @IsIn(SAVED_SEQUENCE_IMAGE_MOTION_EFFECTS)
  @IsOptional()
  image_motion_effect?: (typeof SAVED_SEQUENCE_IMAGE_MOTION_EFFECTS)[number] | null;

  @IsUUID()
  @IsOptional()
  custom_motion_effect_id?: string | null;

  @IsObject()
  @IsOptional()
  image_motion_settings?: Record<string, unknown> | null;

  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(2.5)
  @IsOptional()
  image_motion_speed?: number | null;

  @IsIn(SAVED_SEQUENCE_VIDEO_GENERATION_MODES)
  @IsOptional()
  video_generation_mode?: (typeof SAVED_SEQUENCE_VIDEO_GENERATION_MODES)[number] | null;

  @IsIn(SAVED_SEQUENCE_TEXT_ANIMATION_EFFECTS)
  @IsOptional()
  text_animation_effect?: (typeof SAVED_SEQUENCE_TEXT_ANIMATION_EFFECTS)[number] | null;

  @IsString()
  @IsOptional()
  text_animation_text?: string | null;

  @IsObject()
  @IsOptional()
  text_animation_settings?: Record<string, unknown> | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SavedSequenceSoundEffectInput)
  @IsOptional()
  text_animation_sound_effects?: SavedSequenceSoundEffectInput[] | null;

  @IsString()
  @IsOptional()
  overlay_url?: string | null;

  @IsString()
  @IsOptional()
  overlay_mime_type?: string | null;

  @IsObject()
  @IsOptional()
  overlay_settings?: Record<string, unknown> | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SavedSequenceSoundEffectInput)
  @IsOptional()
  overlay_sound_effects?: SavedSequenceSoundEffectInput[] | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SavedSequenceSoundEffectInput)
  @IsOptional()
  sound_effects?: SavedSequenceSoundEffectInput[] | null;

  @IsIn(SAVED_SEQUENCE_TRANSITIONS)
  @IsOptional()
  transition_to_next?: (typeof SAVED_SEQUENCE_TRANSITIONS)[number] | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SavedSequenceTransitionSoundEffectInput)
  @IsOptional()
  transition_sound_effects?: SavedSequenceTransitionSoundEffectInput[] | null;

  @IsBoolean()
  @IsOptional()
  is_suspense?: boolean;
}