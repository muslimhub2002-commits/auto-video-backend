import { IsEnum, IsOptional, IsString } from 'class-validator';
import { VideoSize } from '../../videos/entities/video.entity';

export class SaveSentenceVideoDto {
  @IsString()
  @IsOptional()
  videoUrl?: string;

  @IsString()
  @IsOptional()
  video_type?: string;

  @IsEnum(VideoSize)
  @IsOptional()
  video_size?: VideoSize;
}
