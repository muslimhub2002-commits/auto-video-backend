import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';

export class UpdateSoundEffectVolumeDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(300)
  volumePercent: number;
}
