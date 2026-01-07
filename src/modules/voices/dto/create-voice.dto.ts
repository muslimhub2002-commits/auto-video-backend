import {
  IsNotEmpty,
  IsString,
  IsUUID,
  IsOptional,
  IsInt,
  Min,
} from 'class-validator';

export class CreateVoiceDto {
  @IsString()
  @IsNotEmpty()
  voice: string;

  @IsUUID()
  @IsNotEmpty()
  user_id: string;

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
