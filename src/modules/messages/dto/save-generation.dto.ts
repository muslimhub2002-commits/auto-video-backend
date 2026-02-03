import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

class SaveGenerationSentenceInput {
  @IsString()
  @IsNotEmpty()
  text: string;

  @IsUUID()
  @IsOptional()
  image_id?: string;

  @IsBoolean()
  @IsOptional()
  isSuspense?: boolean;
}

export class SaveGenerationDto {
  @IsString()
  @IsNotEmpty()
  script: string;

  @IsString()
  @IsOptional()
  subject?: string | null;

  @IsString()
  @IsOptional()
  subject_content?: string | null;

  @IsString()
  @IsOptional()
  length?: string | null;

  @IsString()
  @IsOptional()
  style?: string | null;

  @IsString()
  @IsOptional()
  technique?: string | null;

  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @IsOptional()
  reference_script_ids?: string[];

  @IsString()
  @IsNotEmpty()
  video_url: string;

  @IsUUID()
  @IsOptional()
  chat_id?: string;

  @IsUUID()
  @IsOptional()
  voice_id?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveGenerationSentenceInput)
  @IsOptional()
  sentences?: SaveGenerationSentenceInput[];
}
