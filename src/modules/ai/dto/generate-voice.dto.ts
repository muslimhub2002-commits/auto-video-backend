import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GenerateVoiceDto {
  @IsString()
  @IsNotEmpty()
  script!: string;

  @IsString()
  @IsOptional()
  voiceId?: string;
}

