import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class GenerateVideoFromTextDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  prompt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  resolution?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  aspectRatio?: string;
}
