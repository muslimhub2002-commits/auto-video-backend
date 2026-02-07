import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScriptsService } from './scripts.service';
import { ScriptsController } from './scripts.controller';
import { Script } from './entities/script.entity';
import { Sentence } from './entities/sentence.entity';
import { AiModule } from '../ai/ai.module';
import { ScriptTemplate } from './entities/script-template.entity';
import { ScriptTemplatesController } from './script-templates.controller';
import { ScriptTemplatesService } from './script-templates.service';
import { Image } from '../images/entities/image.entity';
import { Video } from '../videos/entities/video.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Script, Sentence, ScriptTemplate, Image, Video]),
    AiModule,
  ],
  controllers: [ScriptsController, ScriptTemplatesController],
  providers: [ScriptsService, ScriptTemplatesService],
  exports: [ScriptsService],
})
export class ScriptsModule {}
