import { IsOptional, IsString } from 'class-validator';

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
}

