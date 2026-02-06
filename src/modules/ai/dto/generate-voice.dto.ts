import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GenerateVoiceDto {
  @IsString()
  @IsNotEmpty()
  script!: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  sentences?: string[];

  @IsString()
  @IsOptional()
  voiceId?: string;

  @IsString()
  @IsOptional()
  styleInstructions?: string;
}
