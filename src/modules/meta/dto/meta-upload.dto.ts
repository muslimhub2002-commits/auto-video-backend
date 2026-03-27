import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';

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

export const META_UPLOAD_PLATFORMS = ['facebook', 'instagram'] as const;

export class MetaUploadDto {
  @IsUrl({ require_tld: false })
  videoUrl: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(META_UPLOAD_PLATFORMS, { each: true })
  platforms: Array<(typeof META_UPLOAD_PLATFORMS)[number]>;

  @IsOptional()
  @IsUUID()
  scriptId?: string;

  @IsString()
  @IsOptional()
  scriptText?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2200)
  caption?: string;

  @IsBoolean()
  @IsOptional()
  isShortVideo?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => SaveBeforeUploadDto)
  saveBeforeUpload?: SaveBeforeUploadDto;
}