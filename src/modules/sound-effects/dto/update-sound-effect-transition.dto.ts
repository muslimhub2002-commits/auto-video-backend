import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateSoundEffectTransitionDto {
  @IsBoolean()
  isTransitionSound: boolean;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(300)
  @IsOptional()
  volumePercent?: number;
}
