import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateImageFilterDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
