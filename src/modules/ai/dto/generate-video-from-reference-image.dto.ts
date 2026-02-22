import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class GenerateVideoFromReferenceImageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  prompt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  resolution?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  aspectRatio?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    const s = String(value).trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no') return false;
    return Boolean(value);
  })
  isLooping?: boolean;
}
