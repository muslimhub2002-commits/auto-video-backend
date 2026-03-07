import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScriptsService } from './scripts.service';
import { ScriptsController } from './scripts.controller';
import { Script } from './entities/script.entity';
import { Sentence } from './entities/sentence.entity';
import { AiModule } from '../ai/ai.module';
import { ScriptTemplate } from './entities/script-template.entity';
import { ScriptTranslationGroup } from './entities/script-translation-group.entity';
import { ScriptTemplatesController } from './script-templates.controller';
import { ScriptTemplatesService } from './script-templates.service';
import { Image } from '../images/entities/image.entity';
import { Video } from '../videos/entities/video.entity';
import { SentenceSoundEffect } from './entities/sentence-sound-effect.entity';
import { SoundEffect } from '../sound-effects/entities/sound-effect.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Script,
      Sentence,
      SentenceSoundEffect,
      ScriptTemplate,
      ScriptTranslationGroup,
      Image,
      Video,
      SoundEffect,
    ]),
    AiModule,
  ],
  controllers: [ScriptsController, ScriptTemplatesController],
  providers: [ScriptsService, ScriptTemplatesService],
  exports: [ScriptsService],
})
export class ScriptsModule {}
