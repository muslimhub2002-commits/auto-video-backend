import { IsIn, IsOptional, IsString, IsUrl } from 'class-validator';

export class EnsurePublicUrlDto {
  @IsUrl({ require_tld: false })
  url!: string;

  @IsOptional()
  @IsString()
  folder?: string;

  @IsOptional()
  @IsIn(['image', 'video', 'audio'])
  resourceType?: 'image' | 'video' | 'audio';

  @IsOptional()
  @IsString()
  filename?: string;
}
