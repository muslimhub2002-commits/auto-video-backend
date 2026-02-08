import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GenerateVoiceStyleDto {
  @IsString()
  @IsNotEmpty()
  script!: string;

  @IsString()
  @IsOptional()
  model?: string;
}
