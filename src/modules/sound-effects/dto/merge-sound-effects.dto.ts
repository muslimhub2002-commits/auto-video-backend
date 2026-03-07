import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
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
}
