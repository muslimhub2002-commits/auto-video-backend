import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export class YoutubeUploadDto {
  @IsUrl({ require_tld: false })
  videoUrl: string;

  @IsString()
  @MaxLength(100)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsIn(['private', 'public', 'unlisted'])
  privacyStatus?: 'private' | 'public' | 'unlisted';
}
