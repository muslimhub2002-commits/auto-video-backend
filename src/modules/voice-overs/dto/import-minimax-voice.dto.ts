import { IsNotEmpty, IsString } from 'class-validator';

export class ImportMinimaxVoiceDto {
    @IsString()
    @IsNotEmpty()
    voiceId!: string;
}
