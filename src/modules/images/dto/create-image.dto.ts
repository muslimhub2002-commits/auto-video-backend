import {
  IsNotEmpty,
  IsString,
  IsUUID,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
} from 'class-validator';
import { ImageSize, ImageQuality } from '../entities/image.entity';

export class CreateImageDto {
  @IsString()
  @IsNotEmpty()
  image: string;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsUUID()
  @IsNotEmpty()
  user_id: string;

  @IsUUID()
  @IsOptional()
  message_id?: string;

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
  @IsString()
  public_id?: string;
}
