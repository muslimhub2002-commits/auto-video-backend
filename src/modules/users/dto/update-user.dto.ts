import { IsEmail, IsString, MinLength, IsOptional, IsArray, IsInt, Min } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  number_of_videos_generated?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  number_of_images_generated?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  number_of_voices_generated?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roles?: string[];
}

