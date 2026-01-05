import { IsOptional, IsString, IsEnum, IsInt, Min, IsUUID } from 'class-validator';
import { ImageSize, ImageQuality } from '../entities/image.entity';

export class UpdateImageDto {
  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  number_of_times_used?: number;

  @IsOptional()
  @IsString()
  image_style?: string;

  @IsOptional()
  @IsEnum(ImageSize)
  image_size?: ImageSize;

  @IsOptional()
  @IsEnum(ImageQuality)
  image_quality?: ImageQuality;

  @IsOptional()
  @IsUUID()
  message_id?: string;

  @IsOptional()
  @IsString()
  public_id?: string;
}

