import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';

class SaveBeforeUploadSentenceDto {
  @IsString()
  text!: string;

  @IsUUID()
  @IsOptional()
  image_id?: string;
}

class SaveBeforeUploadDto {
  @IsString()
  script!: string;

  // If omitted, backend will use `videoUrl` from this request
  @IsString()
  @IsOptional()
  video_url?: string;

  @IsUUID()
  @IsOptional()
  chat_id?: string;

  @IsUUID()
  @IsOptional()
  voice_id?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveBeforeUploadSentenceDto)
  @IsOptional()
  sentences?: SaveBeforeUploadSentenceDto[];
}

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

  @IsOptional()
  @ValidateNested()
  @Type(() => SaveBeforeUploadDto)
  saveBeforeUpload?: SaveBeforeUploadDto;
}
