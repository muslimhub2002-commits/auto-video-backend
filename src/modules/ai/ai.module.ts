import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { ImagesModule } from '../images/images.module';
import { AiRuntimeService } from './services/ai-runtime.service';
import { AiTextService } from './services/ai-text.service';
import { AiYoutubeService } from './services/ai-youtube.service';
import { AiImageService } from './services/ai-image.service';
import { AiVoiceService } from './services/ai-voice.service';
import { AiVideoService } from './services/ai-video.service';

@Module({
  imports: [ImagesModule],
  controllers: [AiController],
  providers: [
    AiRuntimeService,
    AiTextService,
    AiYoutubeService,
    AiImageService,
    AiVoiceService,
    AiVideoService,
    AiService,
  ],
  exports: [AiService],
})
export class AiModule {}
