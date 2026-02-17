import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
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

  @IsOptional()
  @IsBoolean()
  isSuspense?: boolean;

  @IsOptional()
  @IsIn(['none', 'glitch', 'whip', 'flash', 'fade', 'chromaLeak'])
  transitionToNext?:
    | 'none'
    | 'glitch'
    | 'whip'
    | 'flash'
    | 'fade'
    | 'chromaLeak'
    | null;

  @IsOptional()
  @IsIn([
    'none',
    'colorGrading',
    'animatedLighting',
  ])
  visualEffect?:
    | 'none'
    | 'colorGrading'
    | 'animatedLighting'
    | null;
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

  @IsOptional()
  addSubtitles?: boolean;

  @IsOptional()
  isShort?: boolean;

  @IsUrl({ require_tld: false })
  audioUrl: string;

  @IsArray()
  imageUrls: Array<string | null>;
}
