import { IsOptional, IsUUID } from 'class-validator';

export class UpdateChatDto {
  @IsOptional()
  @IsUUID()
  user_id?: string;
}

