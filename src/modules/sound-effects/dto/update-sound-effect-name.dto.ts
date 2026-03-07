import { IsString } from 'class-validator';

export class UpdateSoundEffectNameDto {
  @IsString()
  name: string;
}
