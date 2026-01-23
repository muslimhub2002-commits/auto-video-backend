import { ArrayUnique, IsArray, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateScriptTemplateDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  scriptIds: string[];
}
