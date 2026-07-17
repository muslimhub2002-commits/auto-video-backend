import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
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
