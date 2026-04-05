import { IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateTextAnimationDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}