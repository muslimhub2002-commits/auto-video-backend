import {
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateRenderVideoDto {
  @IsString()
  @IsNotEmpty()
  sentences: string;

  @IsString()
  @IsNotEmpty()
  scriptLength: string;

  // Optional explicit short-form toggle (9:16). Comes from FormData as a string.
  @IsOptional()
  @IsString()
  isShort?: string;

  @IsOptional()
  @IsNumberString()
  audioDurationSeconds?: string;

  // Render performance and transition options as string flags from FormData
  @IsOptional()
  @IsString()
  useLowerFps?: string;

  @IsOptional()
  @IsString()
  useLowerResolution?: string;

  @IsOptional()
  @IsString()
  addSubtitles?: string;

  @IsOptional()
  @IsString()
  enableGlitchTransitions?: string;

  @IsOptional()
  @IsString()
  enableZoomRotateTransitions?: string;
}
