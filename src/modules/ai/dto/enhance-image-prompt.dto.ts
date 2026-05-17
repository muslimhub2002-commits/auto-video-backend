import { IsString, MaxLength } from 'class-validator';

export class EnhanceImagePromptDto {
  @IsString()
  @MaxLength(5000)
  prompt: string;
}
