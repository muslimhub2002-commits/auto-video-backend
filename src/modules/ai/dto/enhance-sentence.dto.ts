import { IsOptional, IsString, MaxLength } from 'class-validator';

export class EnhanceSentenceDto {
  @IsString()
  @MaxLength(5000)
  sentence: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  style?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  technique?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  systemPrompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  userPrompt?: string;
}
