import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SplitScriptDto {
  @IsString()
  @IsNotEmpty()
  script: string;

  // Optional model override for splitting (should match the model used to generate the script for best results).
  @IsString()
  @IsOptional()
  model?: string;

  // Optional override for the system prompt. If provided, it replaces the default system prompt.
  @IsString()
  @IsOptional()
  systemPrompt?: string;
}
