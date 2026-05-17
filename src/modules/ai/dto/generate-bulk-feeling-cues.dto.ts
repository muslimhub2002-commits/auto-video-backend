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

class BulkFeelingCueSentenceDto {
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
  text: string;
}

export class GenerateBulkFeelingCuesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkFeelingCueSentenceDto)
  sentences: BulkFeelingCueSentenceDto[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  systemPrompt?: string;
}