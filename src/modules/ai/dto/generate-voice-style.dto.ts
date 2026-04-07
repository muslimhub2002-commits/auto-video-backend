import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GenerateVoiceStyleDto {
  @IsString()
  @IsNotEmpty()
  script!: string;

  @IsString()
  @IsOptional()
  model?: string;

  @IsString()
  @IsIn(['full', 'tone-only'])
  @IsOptional()
  instructionMode?: 'full' | 'tone-only';
}
