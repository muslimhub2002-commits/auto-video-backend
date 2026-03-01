import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const ALLOWED_VIDEO_PROMPT_MODES = ['text', 'referenceImage'] as const;

export class GenerateVideoPromptDto {
  // Optional full script context to keep prompts consistent across scenes.
  @IsString()
  @IsOptional()
  script?: string;

  // Sentence text for the specific scene.
  @IsString()
  @IsNotEmpty()
  sentence: string;

  @IsIn(ALLOWED_VIDEO_PROMPT_MODES)
  @IsOptional()
  mode?: (typeof ALLOWED_VIDEO_PROMPT_MODES)[number];

  // Optional LLM model override (if supported by the backend).
  @IsString()
  @IsOptional()
  model?: string;
}
