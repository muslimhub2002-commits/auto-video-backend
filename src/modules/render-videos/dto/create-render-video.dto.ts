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

  // Optional background soundtrack override.
  // - omit => use default soundtrack
  // - "__none__" => mute background music
  // - otherwise => absolute URL (e.g. Cloudinary)
  @IsOptional()
  @IsString()
  backgroundMusicSrc?: string;

  // Optional background soundtrack volume override.
  // Comes from FormData as a string. Expected normalized 0..1.
  @IsOptional()
  @IsNumberString()
  backgroundMusicVolume?: string;
}
