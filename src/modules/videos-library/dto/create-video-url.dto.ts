import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';
import { VideoSize } from '../../videos/entities/video.entity';

export class CreateVideoUrlDto {
  @IsUrl(
    { require_protocol: true },
    { message: 'video must be a valid URL (include https://)' },
  )
  @IsNotEmpty()
  video: string;

  @IsOptional()
  @IsString()
  video_type?: string;

  @IsOptional()
  @IsEnum(VideoSize)
  video_size?: VideoSize;

  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;
}
