import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class YoutubeSeoDto {
  @IsString()
  @MaxLength(20000)
  script: string;

  // Defaults to true for backwards compatibility (existing callers assumed Shorts).
  @IsOptional()
  @IsBoolean()
  isShort?: boolean;

  @IsOptional()
  @IsBoolean()
  useWebSearch?: boolean;
}
