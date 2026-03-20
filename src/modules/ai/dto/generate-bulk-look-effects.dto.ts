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

class BulkLookEffectSentenceDto {
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
    'none',
    'colorGrading',
    'animatedLighting',
    'glassSubtle',
    'glassReflections',
    'glassStrong',
  ])
  visualEffect?:
    | 'none'
    | 'colorGrading'
    | 'animatedLighting'
    | 'glassSubtle'
    | 'glassReflections'
    | 'glassStrong'
    | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  customImageFilterId?: string | null;

  @IsOptional()
  @IsObject()
  imageFilterSettings?: Record<string, unknown> | null;
}

export class GenerateBulkLookEffectsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkLookEffectSentenceDto)
  sentences: BulkLookEffectSentenceDto[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  systemPrompt?: string;
}
