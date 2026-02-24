import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
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

export class YoutubeWallpaperDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  script!: string;

  // Optional: if the user already has a YouTube title, provide it so the thumbnail
  // headline can complement (not copy) the title.
  @IsString()
  @IsOptional()
  @MaxLength(120)
  title?: string;

  // Optional: LLM model to use for crafting the wallpaper prompt/headline.
  @IsString()
  @IsOptional()
  @MaxLength(200)
  promptModel?: string;

  // Optional: which image generator/model to use.
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

  // Optional style string to steer the generation (e.g. "Cinematic film still...").
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  style?: string;

  // Canonical characters extracted during split.
  // Used to keep character depiction consistent and to filter safe characters.
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScriptCharacterInput)
  @IsOptional()
  characters?: ScriptCharacterInput[];
}
