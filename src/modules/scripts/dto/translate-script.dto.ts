import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class TranslateScriptDto {
  // ISO language code to translate INTO (e.g. "ar", "en").
  @IsString()
  @IsNotEmpty()
  targetLanguage: string;

  @IsIn(['google', 'llm'])
  @IsOptional()
  method?: 'google' | 'llm';

  // Used when method = "llm".
  @IsString()
  @IsOptional()
  model?: string;
}
