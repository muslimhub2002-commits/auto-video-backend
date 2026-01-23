import { IsNotEmpty, IsOptional, IsString, IsUrl, Length } from 'class-validator';

export class CreateVoiceUrlDto {
  @IsUrl({ require_protocol: true }, { message: 'voice must be a valid URL (include https://)' })
  @IsNotEmpty()
  voice: string;

  @IsOptional()
  @IsString()
  voice_type?: string;

  @IsOptional()
  @IsString()
  voice_lang?: string;

  // Optional client-provided SHA-256 hex to enable dedupe without re-downloading.
  @IsOptional()
  @IsString()
  @Length(64, 64)
  hash?: string;
}
