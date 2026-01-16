import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';

class ReferenceScriptDto {
  @IsString()
  script: string;

  @IsString()
  @IsOptional()
  id?: string;

  @IsString()
  @IsOptional()
  title?: string;
}

export class GenerateScriptDto {
  // High-level topic, e.g. "religious (Islam)", "motivational"
  @IsString()
  @IsOptional()
  subject?: string;

  // More specific focus within the subject, e.g. "Quranic Miracles"
  @IsString()
  @IsOptional()
  subjectContent?: string;

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

  // Optional reference scripts (full text) used as style exemplars.
  // When provided, they override style/tone and systemPrompt-based writing goals.
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReferenceScriptDto)
  @IsOptional()
  referenceScripts?: ReferenceScriptDto[];
}
