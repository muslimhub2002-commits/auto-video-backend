import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsArray,
  Matches,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

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

export class GenerateImageDto {
  @IsString()
  @IsNotEmpty()
  sentence: string;

  // Optional full script context. Used ONLY to keep the image prompt representative
  // of the script's time/era/context (continuity), not to be copied verbatim.
  @IsString()
  @IsOptional()
  @MaxLength(20000)
  script?: string;

  // Optional override: if provided, the backend will generate the image directly
  // from this prompt instead of generating a prompt from the sentence.
  @IsString()
  @IsOptional()
  prompt?: string;

  @IsString()
  @IsOptional()
  @IsIn(['single', 'start', 'end'])
  frameType?: 'single' | 'start' | 'end';

  @IsString()
  @IsOptional()
  @MaxLength(4000)
  continuityPrompt?: string;

  @IsString()
  @IsOptional()
  subject?: string;

  @IsString()
  @IsOptional()
  style?: string;

  // Optional: LLM model to use for generating the image prompt from the sentence.
  // If omitted, the server default text model is used.
  @IsString()
  @IsOptional()
  @MaxLength(200)
  promptModel?: string;

  // Optional: which image generator/model to use.
  // Supported: "leonardo", OpenAI ("gpt-image-1", "gpt-image-1-mini", "gpt-image-1.5"),
  // and Imagen ("imagen-3", "imagen-4", "imagen-4-ultra"), plus ModelsLab stable diffusion
  // community models via the prefix: "modelslab:<model_id>" (e.g. "modelslab:sd-xl-10-base").
  @IsString()
  @IsOptional()
  @Matches(
    /^(leonardo|grok-imagine-image|gpt-image-1|gpt-image-1-mini|gpt-image-1\.5|imagen-3|imagen-4|imagen-4-ultra|modelslab:[a-z0-9][a-z0-9-_]{0,40})$/,
    {
      message:
        'imageModel must be one of: leonardo, grok-imagine-image, gpt-image-1, gpt-image-1-mini, gpt-image-1.5, imagen-3, imagen-4, imagen-4-ultra, or modelslab:<model_id>',
    },
  )
  @MaxLength(50)
  imageModel?: string;

  // Optional script length (e.g. "30 seconds", "1 minute") so the
  // backend can pick an appropriate aspect ratio for the image.
  @IsString()
  @IsOptional()
  scriptLength?: string;

  // Optional explicit short-form toggle (9:16). If omitted, we fall back
  // to scriptLength heuristics for backward compatibility.
  @IsBoolean()
  @IsOptional()
  isShort?: boolean;

  // Optional canonical script characters extracted during splitting.
  // Used for safe mention classification and consistent character depiction.
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScriptCharacterInput)
  @IsOptional()
  characters?: ScriptCharacterInput[];

  // Optional per-sentence override: if provided, the backend will use these
  // canonical character keys directly and skip mention/detection checks.
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  forcedCharacterKeys?: string[];
}
