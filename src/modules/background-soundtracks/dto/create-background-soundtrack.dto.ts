import { IsNotEmpty, IsString } from 'class-validator';

export class CreateBackgroundSoundtrackDto {
  @IsString()
  @IsNotEmpty()
  title: string;
}
