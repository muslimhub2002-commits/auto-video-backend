import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class YoutubeSeoDto {
  @IsString()
  @MaxLength(20000)
  script: string;

  // Output language ISO code (e.g. "en", "ar", "fr", "zh-CN").
  @IsOptional()
  @IsString()
  @MaxLength(20)
  language?: string;

  // Defaults to true for backwards compatibility (existing callers assumed Shorts).
  @IsOptional()
  @IsBoolean()
  isShort?: boolean;

  @IsOptional()
  @IsBoolean()
  useWebSearch?: boolean;
}
