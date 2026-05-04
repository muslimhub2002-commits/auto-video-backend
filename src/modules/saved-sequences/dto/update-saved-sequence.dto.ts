import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateSavedSequenceDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  title?: string;
}