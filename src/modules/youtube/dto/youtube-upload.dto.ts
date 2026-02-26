import {
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
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

  // Optional: which script should receive the youtube_url after upload succeeds.
  @IsUUID()
  @IsOptional()
  scriptId?: string;

  // Fallback: when scriptId is not available, backend can create/update a Script
  // using this text and then set youtube_url on that script.
  @IsString()
  @IsOptional()
  scriptText?: string;

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
  @IsString()
  @MaxLength(5)
  @Matches(/^\d+$/)
  categoryId?: string;

  @IsOptional()
  @IsBoolean()
  selfDeclaredMadeForKids?: boolean;

  // RFC3339 timestamp, e.g. 2026-01-13T18:00:00+03:00
  // YouTube requires privacyStatus=private when publishAt is set.
  @IsOptional()
  @IsString()
  @IsISO8601({ strict: true })
  publishAt?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SaveBeforeUploadDto)
  saveBeforeUpload?: SaveBeforeUploadDto;
}
