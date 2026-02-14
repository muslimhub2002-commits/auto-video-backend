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

class CreateSentenceInput {
  @IsString()
  @IsNotEmpty()
  text: string;

  @IsUUID()
  @IsOptional()
  image_id?: string;

  @IsUUID()
  @IsOptional()
  start_frame_image_id?: string;

  @IsUUID()
  @IsOptional()
  end_frame_image_id?: string;

  @IsUUID()
  @IsOptional()
  video_id?: string;

  @IsBoolean()
  @IsOptional()
  isSuspense?: boolean;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  forced_character_keys?: string[];
}

class ScriptCharacterInput {
  @IsString()
  @IsNotEmpty()
  key: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsBoolean()
  isSahaba: boolean;

  @IsBoolean()
  isProphet: boolean;

  @IsBoolean()
  isWoman: boolean;
}

export class CreateScriptDto {
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
  @IsOptional()
  title?: string;

  @IsUUID()
  @IsOptional()
  message_id?: string;

  @IsUUID()
  @IsOptional()
  voice_id?: string;

  @IsString()
  @IsOptional()
  video_url?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSentenceInput)
  @IsOptional()
  sentences?: CreateSentenceInput[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScriptCharacterInput)
  @IsOptional()
  characters?: ScriptCharacterInput[];
}
