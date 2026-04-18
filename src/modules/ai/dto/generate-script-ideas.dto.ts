import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { GenerateScriptDto } from './generate-script.dto';

class ReferenceScriptIdeaDto {
  @IsString()
  script!: string;

  @IsString()
  @IsOptional()
  id?: string;

  @IsString()
  @IsOptional()
  title?: string;
}

export class GenerateScriptIdeasDto extends GenerateScriptDto {
  @Type(() => Number)
  @Min(5)
  @Max(5)
  @IsOptional()
  count?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReferenceScriptIdeaDto)
  @IsOptional()
  declare referenceScripts?: ReferenceScriptIdeaDto[];
}
