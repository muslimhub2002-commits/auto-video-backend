import { IsIn, IsOptional, IsString } from 'class-validator';

export class UploadFileDto {
  @IsOptional()
  @IsString()
  folder?: string;

  @IsOptional()
  @IsIn(['image', 'video', 'audio'])
  resourceType?: 'image' | 'video' | 'audio';
}
