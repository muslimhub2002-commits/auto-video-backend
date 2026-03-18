import { Type } from 'class-transformer';
import {
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpdateSoundEffectDto {
  @IsString()
  name: string;

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
