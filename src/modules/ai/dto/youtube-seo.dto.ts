import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class YoutubeSeoDto {
  @IsString()
  @MaxLength(20000)
  script: string;

  @IsOptional()
  @IsBoolean()
  useWebSearch?: boolean;
}
