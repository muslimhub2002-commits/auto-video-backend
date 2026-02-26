import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SplitIntoShortsDto {
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  sentences: string[];

  @IsString()
  @IsOptional()
  model?: string;

  @IsString()
  @IsOptional()
  systemPrompt?: string;
}
