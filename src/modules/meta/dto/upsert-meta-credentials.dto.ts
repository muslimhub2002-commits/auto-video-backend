import { Type } from 'class-transformer';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertMetaCredentialsDto {
  @IsOptional()
  @IsString()
  accessToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tokenType?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDateString()
  accessTokenExpiresAt?: string;

  @IsOptional()
  @IsString()
  facebookPageAccessToken?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDateString()
  facebookPageTokenExpiresAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  facebookPageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  instagramAccountId?: string;
}
