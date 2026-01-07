import { IsOptional, IsString, IsInt, Min } from 'class-validator';

export class UpdateVoiceDto {
  @IsOptional()
  @IsString()
  voice?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  number_of_times_used?: number;

  @IsOptional()
  @IsString()
  voice_type?: string;

  @IsOptional()
  @IsString()
  voice_lang?: string;
}
