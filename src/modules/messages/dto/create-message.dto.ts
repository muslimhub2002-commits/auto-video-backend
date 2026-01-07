import { IsNotEmpty, IsUUID, IsOptional } from 'class-validator';

export class CreateMessageDto {
  @IsUUID()
  @IsNotEmpty()
  chat_id: string;

  @IsOptional()
  @IsUUID()
  video_id?: string;

  @IsOptional()
  @IsUUID()
  voice_id?: string;
}
