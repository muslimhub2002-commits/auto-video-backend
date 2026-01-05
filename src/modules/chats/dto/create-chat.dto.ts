import { IsOptional, IsUUID } from 'class-validator';

export class CreateChatDto {
  @IsOptional()
  @IsUUID()
  user_id?: string;
}

