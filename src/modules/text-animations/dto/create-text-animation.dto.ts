import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { SENTENCE_SOUND_EFFECT_TIMING_MODES } from '../../scripts/entities/sentence-sound-effect.entity';

class TextAnimationSoundEffectInput {
  @IsUUID()
  sound_effect_id: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  url?: string;

  @Type(() => Number)
  @Min(0)
  @Max(300)
  @IsOptional()
  volume_percent?: number;

  @Type(() => Number)
  @Min(0)
  @IsOptional()
  delay_seconds?: number;

  @IsIn(SENTENCE_SOUND_EFFECT_TIMING_MODES)
  @IsOptional()
  timing_mode?: (typeof SENTENCE_SOUND_EFFECT_TIMING_MODES)[number];

  @IsObject()
  @IsOptional()
  audio_settings_override?: Record<string, unknown> | null;

  @Type(() => Number)
  @Min(0)
  @IsOptional()
  duration_seconds?: number | null;
}

export class CreateTextAnimationDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TextAnimationSoundEffectInput)
  sound_effects?: TextAnimationSoundEffectInput[];
}