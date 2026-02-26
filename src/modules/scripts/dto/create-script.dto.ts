import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

const ALLOWED_TRANSITIONS = [
  'none',
  'glitch',
  'whip',
  'flash',
  'fade',
  'chromaLeak',
] as const;

const ALLOWED_VISUAL_EFFECTS = ['colorGrading', 'animatedLighting'] as const;

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

  @IsIn(ALLOWED_TRANSITIONS)
  @IsOptional()
  transition_to_next?: (typeof ALLOWED_TRANSITIONS)[number] | null;

  @IsIn(ALLOWED_VISUAL_EFFECTS)
  @IsOptional()
  visual_effect?: (typeof ALLOWED_VISUAL_EFFECTS)[number] | null;

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

class ShortScriptInput {
  @IsString()
  @IsNotEmpty()
  script: string;

  @IsString()
  @IsOptional()
  title?: string | null;

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

  @IsString()
  @IsOptional()
  youtube_url?: string | null;

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

  // When true, this script row is treated as a derived Short and hidden from the normal scripts listing.
  @IsBoolean()
  @IsOptional()
  is_short_script?: boolean;

  // Optional: when present, overrides the parent script's current derived shorts.
  // Each entry is stored as its own Script row (with isShortScript=true), and
  // the parent stores the ordered list of short IDs in `shorts_scripts`.
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShortScriptInput)
  @IsOptional()
  shorts_scripts?: ShortScriptInput[];

  // Preferred: link existing short scripts by ID.
  // Workflow: save short scripts first (as `is_short_script=true`), then save the full script with these IDs.
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @IsOptional()
  shorts_script_ids?: string[];
}
