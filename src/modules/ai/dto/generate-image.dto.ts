import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class GenerateImageDto {
  @IsString()
  @IsNotEmpty()
  sentence: string;

  // Optional full script context. Used ONLY to keep the image prompt representative
  // of the script's time/era/context (continuity), not to be copied verbatim.
  @IsString()
  @IsOptional()
  @MaxLength(20000)
  script?: string;

  // Optional override: if provided, the backend will generate the image directly
  // from this prompt instead of generating a prompt from the sentence.
  @IsString()
  @IsOptional()
  prompt?: string;

  @IsString()
  @IsOptional()
  @IsIn(['single', 'start', 'end'])
  frameType?: 'single' | 'start' | 'end';

  @IsString()
  @IsOptional()
  @MaxLength(4000)
  continuityPrompt?: string;

  @IsString()
  @IsOptional()
  subject?: string;

  @IsString()
  @IsOptional()
  style?: string;

  // Optional script length (e.g. "30 seconds", "1 minute") so the
  // backend can pick an appropriate aspect ratio for the image.
  @IsString()
  @IsOptional()
  scriptLength?: string;

  // Optional explicit short-form toggle (9:16). If omitted, we fall back
  // to scriptLength heuristics for backward compatibility.
  @IsBoolean()
  @IsOptional()
  isShort?: boolean;
}
