import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class TranslateDto {
  // ISO language code to translate INTO (e.g. "ar", "en", "fr").
  @IsString()
  @IsNotEmpty()
  targetLanguage: string;

  // Translation method.
  @IsIn(['google', 'llm'])
  @IsOptional()
  method?: 'google' | 'llm';

  // LLM model override (used when method = "llm").
  @IsString()
  @IsOptional()
  model?: string;

  // Full script text to translate.
  @IsString()
  @IsOptional()
  script?: string;

  // Optional ordered list of sentences to translate. Output preserves order and count.
  @IsArray()
  @IsString({ each: true })
  @ArrayNotEmpty()
  @IsOptional()
  sentences?: string[];
}
