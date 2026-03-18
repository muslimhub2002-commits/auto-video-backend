import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateMotionEffectDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
