import { IsOptional, IsUUID } from 'class-validator';

export class UpdateSentenceMediaDto {
  @IsOptional()
  @IsUUID()
  start_frame_image_id?: string | null;

  @IsOptional()
  @IsUUID()
  end_frame_image_id?: string | null;

  @IsOptional()
  @IsUUID()
  video_id?: string | null;
}
