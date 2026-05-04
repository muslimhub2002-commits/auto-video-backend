import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { SavedSequenceSceneInput } from './saved-sequence-scene.dto';

export class CreateSavedSequenceDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SavedSequenceSceneInput)
  scenes: SavedSequenceSceneInput[];
}