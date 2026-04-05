import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateTextAnimationDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}