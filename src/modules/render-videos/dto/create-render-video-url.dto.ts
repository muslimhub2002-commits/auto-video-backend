import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class SentenceDto {
  @IsString()
  @IsNotEmpty()
  text: string;
}

export class CreateRenderVideoUrlDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SentenceDto)
  sentences: SentenceDto[];

  @IsString()
  @IsNotEmpty()
  scriptLength: string;

  @IsOptional()
  @IsNumber()
  audioDurationSeconds?: number;

  @IsOptional()
  useLowerFps?: boolean;

  @IsOptional()
  useLowerResolution?: boolean;

  @IsOptional()
  enableGlitchTransitions?: boolean;

  @IsOptional()
  enableZoomRotateTransitions?: boolean;

  @IsUrl({ require_tld: false })
  audioUrl: string;

  @IsArray()
  imageUrls: Array<string | null>;
}
