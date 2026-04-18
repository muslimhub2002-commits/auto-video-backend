import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateSoundEditPresetDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(300)
  @IsOptional()
  volumePercent?: number;

  @IsObject()
  @IsOptional()
  audioSettings?: Record<string, unknown> | null;
}
