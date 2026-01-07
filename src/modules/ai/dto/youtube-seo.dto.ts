import { IsString, MaxLength } from 'class-validator';

export class YoutubeSeoDto {
  @IsString()
  @MaxLength(20000)
  script: string;
}
