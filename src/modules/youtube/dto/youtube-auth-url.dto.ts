import { IsOptional, IsString } from 'class-validator';

export class YoutubeAuthUrlDto {
  @IsOptional()
  @IsString()
  redirectTo?: string;
}
