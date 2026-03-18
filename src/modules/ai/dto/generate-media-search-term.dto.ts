import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class GenerateMediaSearchTermDto {
  @IsIn(['image', 'video'])
  medium: 'image' | 'video';

  @IsString()
  @MaxLength(5000)
  sentence: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  script?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;
}
