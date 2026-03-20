import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

class BulkMotionEffectSentenceDto {
  @Type(() => Number)
  @IsNumber()
  index: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  sentenceId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(12000)
  imagePrompt: string;

  @IsOptional()
  @IsIn([
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
  ])
  imageMotionEffect?:
    | 'default'
    | 'slowZoomIn'
    | 'slowZoomOut'
    | 'diagonalDrift'
    | 'cinematicPan'
    | 'focusShift'
    | 'parallaxMotion'
    | 'shakeMicroMotion'
    | 'splitMotion'
    | 'rotationDrift'
    | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  imageMotionSpeed?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  customMotionEffectId?: string | null;

  @IsOptional()
  @IsObject()
  imageMotionSettings?: Record<string, unknown> | null;
}

export class GenerateBulkMotionEffectsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkMotionEffectSentenceDto)
  sentences: BulkMotionEffectSentenceDto[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  systemPrompt?: string;
}
