import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateOverlayDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  settings?: unknown;

  @IsOptional()
  @IsString()
  sourceUrl?: string | null;
}