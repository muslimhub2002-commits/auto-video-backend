import { IsOptional, IsUUID } from 'class-validator';

export class UpdateMessageDto {
  @IsOptional()
  @IsUUID()
  chat_id?: string;

  @IsOptional()
  @IsUUID()
  video_id?: string;

  @IsOptional()
  @IsUUID()
  voice_id?: string;
}

