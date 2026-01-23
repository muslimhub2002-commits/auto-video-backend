import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

class UpdateSentenceInput {
  @IsString()
  @IsNotEmpty()
  text: string;

  @IsUUID()
  @IsOptional()
  image_id?: string;

  @IsBoolean()
  @IsOptional()
  isSuspense?: boolean;
}

export class UpdateScriptDto {
  @IsString()
  @IsOptional()
  script?: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsUUID()
  @IsOptional()
  voice_id?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateSentenceInput)
  @IsOptional()
  sentences?: UpdateSentenceInput[];
}
