import { IsOptional, IsString } from 'class-validator';

export class CreateSoundEffectDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  name?: string;
}
