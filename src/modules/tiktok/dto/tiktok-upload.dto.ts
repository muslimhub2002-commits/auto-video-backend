import { IsBoolean, IsIn, IsOptional, IsString, IsUrl, IsUUID, MaxLength } from 'class-validator';

export class TiktokUploadDto {
  @IsUrl({ require_tld: false })
  videoUrl!: string;

  @IsString()
  @IsOptional()
  @MaxLength(2200)
  caption?: string;

  @IsString()
  @IsOptional()
  @IsIn([
    'PUBLIC_TO_EVERYONE',
    'MUTUAL_FOLLOW_FRIENDS',
    'FOLLOWER_OF_CREATOR',
    'SELF_ONLY',
  ])
  privacyLevel?: string;

  @IsBoolean()
  @IsOptional()
  disableComment?: boolean;

  @IsBoolean()
  @IsOptional()
  disableDuet?: boolean;

  @IsBoolean()
  @IsOptional()
  disableStitch?: boolean;

  @IsBoolean()
  @IsOptional()
  brandOrganicToggle?: boolean;

  @IsBoolean()
  @IsOptional()
  brandContentToggle?: boolean;

  @IsBoolean()
  consentConfirmed!: boolean;

  @IsUUID()
  @IsOptional()
  scriptId?: string;

  @IsString()
  @IsOptional()
  scriptText?: string;
}