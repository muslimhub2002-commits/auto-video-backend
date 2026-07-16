import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ElevenLabsVoiceSettingsInput {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  stability?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  similarityBoost?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  style?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(1.5)
  @IsOptional()
  speed?: number;

  @IsBoolean()
  @IsOptional()
  useSpeakerBoost?: boolean;
}

class MinimaxVoiceSettingsInput {
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(2)
  @IsOptional()
  speed?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(10)
  @IsOptional()
  vol?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-12)
  @Max(12)
  @IsOptional()
  pitch?: number;

  @IsString()
  @IsIn([
    'happy',
    'sad',
    'angry',
    'fearful',
    'disgusted',
    'surprised',
    'calm',
    'fluent',
    'whisper',
  ])
  @IsOptional()
  emotion?: string;
}

export class GenerateVoiceDto {
  @IsString()
  @IsNotEmpty()
  script!: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  sentences?: string[];

  @IsString()
  @IsOptional()
  voiceId?: string;

  @IsString()
  @IsOptional()
  styleInstructions?: string;

  @ValidateNested()
  @Type(() => ElevenLabsVoiceSettingsInput)
  @IsOptional()
  elevenLabsSettings?: ElevenLabsVoiceSettingsInput;

  @IsString()
  @IsIn(['eleven_multilingual_v2', 'eleven_v3'])
  @IsOptional()
  elevenLabsModel?: 'eleven_multilingual_v2' | 'eleven_v3';

  @ValidateNested()
  @Type(() => MinimaxVoiceSettingsInput)
  @IsOptional()
  minimaxSettings?: MinimaxVoiceSettingsInput;
}
