import { IsOptional, IsString } from 'class-validator';

export class UpdateOverlayDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  settings?: unknown;

  @IsOptional()
  @IsString()
  sourceUrl?: string | null;
}