import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GenerateImageDto {
  @IsString()
  @IsNotEmpty()
  sentence: string;

  @IsString()
  @IsOptional()
  subject?: string;

  @IsString()
  @IsOptional()
  style?: string;

  // Optional script length (e.g. "30 seconds", "1 minute") so the
  // backend can pick an appropriate aspect ratio for the image.
  @IsString()
  @IsOptional()
  scriptLength?: string;
}
