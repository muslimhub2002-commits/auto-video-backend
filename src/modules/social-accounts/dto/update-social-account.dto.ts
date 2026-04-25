import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSocialAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;

  @IsOptional()
  @IsObject()
  fields?: Record<string, unknown>;
}