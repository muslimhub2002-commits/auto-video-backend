import { IsNotEmpty, IsString } from 'class-validator';

export class ImportElevenLabsVoiceDto {
  @IsString()
  @IsNotEmpty()
  voiceId!: string;
}
