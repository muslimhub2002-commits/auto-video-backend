import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class EnhanceScriptDto {
  @IsString()
  @IsNotEmpty()
  script: string;

  // Desired length, e.g. "30 seconds", "1 minute"
  @IsString()
  @IsOptional()
  length?: string;

  // Style/tone, e.g. "Formal", "Conversational"
  @IsString()
  @IsOptional()
  style?: string;

  // Optional model override (e.g. "gpt-4o-mini", "gpt-4.1")
  @IsString()
  @IsOptional()
  model?: string;

  // Optional override for the system prompt. If provided, it replaces the default system prompt.
  @IsString()
  @IsOptional()
  systemPrompt?: string;
}
