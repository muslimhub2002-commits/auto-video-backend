import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class MergeSoundEffectItemDto {
  @IsUUID()
  sound_effect_id: string;

  @IsOptional()
  @IsNumber()
  delay_seconds?: number;

  @IsOptional()
  @IsNumber()
  volume_percent?: number;

  @IsOptional()
  @IsNumber()
  trim_start_seconds?: number;

  @IsOptional()
  @IsNumber()
  duration_seconds?: number;
}

export class MergeSoundEffectsDto {
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => MergeSoundEffectItemDto)
  items: MergeSoundEffectItemDto[];

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsNumber()
  volumePercent?: number;

  @IsOptional()
  @IsObject()
  audioSettings?: Record<string, unknown> | null;

  @IsOptional()
  @IsBoolean()
  isPreset?: boolean;

  @IsOptional()
  @IsBoolean()
  requireUniqueTitle?: boolean;
}
