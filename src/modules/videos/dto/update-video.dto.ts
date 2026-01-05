import { IsOptional, IsString, IsEnum, IsInt, Min } from 'class-validator';
import { VideoSize } from '../entities/video.entity';

export class UpdateVideoDto {
  @IsOptional()
  @IsString()
  video?: string;

  @IsOptional()
  @IsEnum(VideoSize)
  video_size?: VideoSize;

  @IsOptional()
  @IsString()
  video_type?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;
}

