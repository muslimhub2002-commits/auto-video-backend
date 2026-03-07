import { IsBoolean } from 'class-validator';

export class UpdateSoundEffectTransitionDto {
  @IsBoolean()
  isTransitionSound: boolean;
}
