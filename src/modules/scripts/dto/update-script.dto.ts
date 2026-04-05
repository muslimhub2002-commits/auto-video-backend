import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { SENTENCE_SOUND_EFFECT_TIMING_MODES } from '../entities/sentence-sound-effect.entity';

const ALLOWED_TRANSITIONS = [
  'none',
  'glitch',
  'whip',
  'flash',
  'fade',
  'chromaLeak',
] as const;

const ALLOWED_VISUAL_EFFECTS = [
  'colorGrading',
  'animatedLighting',
  'glassSubtle',
  'glassReflections',
  'glassStrong',
] as const;

const ALLOWED_IMAGE_MOTION_EFFECTS = [
  'default',
  'slowZoomIn',
  'slowZoomOut',
  'diagonalDrift',
  'cinematicPan',
  'focusShift',
  'parallaxMotion',
  'shakeMicroMotion',
  'splitMotion',
  'rotationDrift',
] as const;

const ALLOWED_IMAGE_EFFECTS_MODES = ['quick', 'detailed'] as const;
const ALLOWED_SCENE_TABS = ['image', 'video', 'text'] as const;
const ALLOWED_TEXT_ANIMATION_EFFECTS = [
  'popInBounceHook',
  'slideCutFast',
  'scalePunchZoom',
  'maskReveal',
  'glitchFlashHook',
  'kineticTypography',
] as const;

class SentenceSoundEffectInput {
  @IsUUID()
  sound_effect_id: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  delay_seconds?: number;

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
  audio_settings_override?: Record<string, unknown> | null;
}

class TransitionSoundEffectInput {
  @IsUUID()
  sound_effect_id: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  url?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  delay_seconds?: number;

  @IsNumber()
  @Min(0)
  @Max(300)
  @IsOptional()
  volume_percent?: number;
}

class UpdateSentenceInput {
  @IsString()
  @IsNotEmpty()
  text: string;

  @IsBoolean()
  @IsOptional()
  align_sound_effects_to_scene_end?: boolean;

  @IsUUID()
  @IsOptional()
  image_id?: string;

  @IsUUID()
  @IsOptional()
  secondary_image_id?: string;

  @IsUUID()
  @IsOptional()
  start_frame_image_id?: string;

  @IsUUID()
  @IsOptional()
  end_frame_image_id?: string;

  @IsUUID()
  @IsOptional()
  video_id?: string;

  @IsUUID()
  @IsOptional()
  text_background_image_id?: string;

  @IsUUID()
  @IsOptional()
  text_background_video_id?: string;

  @IsString()
  @IsOptional()
  video_prompt?: string;

  @IsIn(ALLOWED_TRANSITIONS)
  @IsOptional()
  transition_to_next?: (typeof ALLOWED_TRANSITIONS)[number] | null;

  @IsIn(ALLOWED_VISUAL_EFFECTS)
  @IsOptional()
  visual_effect?: (typeof ALLOWED_VISUAL_EFFECTS)[number] | null;

  @IsIn(ALLOWED_IMAGE_MOTION_EFFECTS)
  @IsOptional()
  image_motion_effect?: (typeof ALLOWED_IMAGE_MOTION_EFFECTS)[number] | null;

  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(2.5)
  @IsOptional()
  image_motion_speed?: number | null;

  @IsIn(ALLOWED_IMAGE_EFFECTS_MODES)
  @IsOptional()
  image_effects_mode?: (typeof ALLOWED_IMAGE_EFFECTS_MODES)[number] | null;

  @IsIn(ALLOWED_SCENE_TABS)
  @IsOptional()
  scene_tab?: (typeof ALLOWED_SCENE_TABS)[number] | null;

  @IsUUID()
  @IsOptional()
  image_filter_id?: string | null;

  @IsObject()
  @IsOptional()
  image_filter_settings?: Record<string, unknown> | null;

  @IsUUID()
  @IsOptional()
  motion_effect_id?: string | null;

  @IsObject()
  @IsOptional()
  image_motion_settings?: Record<string, unknown> | null;

  @IsString()
  @IsOptional()
  text_animation_text?: string | null;

  @IsIn(ALLOWED_TEXT_ANIMATION_EFFECTS)
  @IsOptional()
  text_animation_effect?: (typeof ALLOWED_TEXT_ANIMATION_EFFECTS)[number] | null;

  @IsUUID()
  @IsOptional()
  text_animation_id?: string | null;

  @IsObject()
  @IsOptional()
  text_animation_settings?: Record<string, unknown> | null;

  @IsBoolean()
  @IsOptional()
  isSuspense?: boolean;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  forced_character_keys?: string[];

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  character_keys?: string[];

  @IsString()
  @IsOptional()
  location_key?: string | null;

  @IsString()
  @IsOptional()
  forced_location_key?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SentenceSoundEffectInput)
  @IsOptional()
  sound_effects?: SentenceSoundEffectInput[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransitionSoundEffectInput)
  @IsOptional()
  transition_sound_effects?: TransitionSoundEffectInput[];
}

class ScriptCharacterInput {
  @IsString()
  @IsNotEmpty()
  key: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsBoolean()
  isSahaba: boolean;

  @IsBoolean()
  isProphet: boolean;

  @IsBoolean()
  isWoman: boolean;
}

class ScriptLocationInput {
  @IsString()
  @IsNotEmpty()
  key: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;
}

class VoiceOverChunkInput {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  index: number;

  @IsString()
  @IsNotEmpty()
  text: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  sentences?: string[];

  @IsString()
  @IsOptional()
  provider?: string | null;

  @IsString()
  @IsOptional()
  mimeType?: string | null;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  durationSeconds?: number | null;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  estimatedSeconds?: number | null;

  @IsString()
  @IsOptional()
  fileName?: string | null;

  @IsString()
  @IsOptional()
  createdAt?: string | null;

  @IsString()
  @IsNotEmpty()
  url: string;
}

class ShortScriptInput {
  @IsString()
  @IsNotEmpty()
  script: string;

  @IsString()
  @IsOptional()
  title?: string | null;

  @IsString()
  @IsOptional()
  video_url?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateSentenceInput)
  @IsOptional()
  sentences?: UpdateSentenceInput[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScriptCharacterInput)
  @IsOptional()
  characters?: ScriptCharacterInput[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScriptLocationInput)
  @IsOptional()
  locations?: ScriptLocationInput[];
}

export class UpdateScriptDto {
  @IsString()
  @IsOptional()
  script?: string;

  // ISO language code (e.g. "en", "ar").
  @IsString()
  @IsOptional()
  language?: string;

  @IsString()
  @IsOptional()
  subject?: string | null;

  @IsString()
  @IsOptional()
  subject_content?: string | null;

  @IsString()
  @IsOptional()
  length?: string | null;

  @IsString()
  @IsOptional()
  style?: string | null;

  @IsString()
  @IsOptional()
  technique?: string | null;

  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @IsOptional()
  reference_script_ids?: string[];

  @IsString()
  @IsOptional()
  title?: string;

  @IsUUID()
  @IsOptional()
  voice_id?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VoiceOverChunkInput)
  @IsOptional()
  voice_over_chunks?: VoiceOverChunkInput[] | null;

  @IsString()
  @IsOptional()
  video_url?: string | null;

  @IsString()
  @IsOptional()
  youtube_url?: string | null;

  @IsString()
  @IsOptional()
  facebook_url?: string | null;

  @IsString()
  @IsOptional()
  instagram_url?: string | null;

  @IsString()
  @IsOptional()
  tiktok_url?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateSentenceInput)
  @IsOptional()
  sentences?: UpdateSentenceInput[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScriptCharacterInput)
  @IsOptional()
  characters?: ScriptCharacterInput[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScriptLocationInput)
  @IsOptional()
  locations?: ScriptLocationInput[];

  // When true, this script row is treated as a derived Short and hidden from the normal scripts listing.
  @IsBoolean()
  @IsOptional()
  is_short_script?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShortScriptInput)
  @IsOptional()
  shorts_scripts?: ShortScriptInput[];

  // Preferred: link existing short scripts by ID.
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @IsOptional()
  shorts_script_ids?: string[];
}
