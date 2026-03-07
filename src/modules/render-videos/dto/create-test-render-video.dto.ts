import { IsOptional, IsString } from 'class-validator';
import { CreateRenderVideoDto } from './create-render-video.dto';

export class CreateTestRenderVideoDto extends CreateRenderVideoDto {
  @IsOptional()
  @IsString()
  isSilent?: string;
}
