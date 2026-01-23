import { Type } from 'class-transformer';
import {
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
