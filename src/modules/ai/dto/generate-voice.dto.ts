import {
  IsArray,
  IsBoolean,
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
}
