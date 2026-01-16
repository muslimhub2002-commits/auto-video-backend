import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Script } from './entities/script.entity';
import { Sentence } from './entities/sentence.entity';
import { CreateScriptDto } from './dto/create-script.dto';
import { AiService } from '../ai/ai.service';

@Injectable()
export class ScriptsService {
  constructor(
    @InjectRepository(Script)
    private readonly scriptRepository: Repository<Script>,
    @InjectRepository(Sentence)
    private readonly sentenceRepository: Repository<Sentence>,
    private readonly aiService: AiService,
  ) {}

  async findByScriptText(userId: string, scriptText: string): Promise<Script | null> {
    const trimmed = (scriptText ?? '').trim();
    if (!trimmed) return null;

    return this.scriptRepository.findOne({
      where: {
        user_id: userId,
        script: trimmed,
      },
    });
  }

  async create(
    userId: string,
    createScriptDto: CreateScriptDto,
  ): Promise<Script> {
    const {
      script,
      message_id,
      voice_id,
      sentences,
      title: providedTitle,
    } = createScriptDto;
    const trimmedScript = script.trim();

    // If an identical script already exists for this user, update it instead
    // of creating a new row, similar to how images are de-duplicated.
    const existingScript = await this.scriptRepository.findOne({
      where: {
        user_id: userId,
        script: trimmedScript,
      },
    });

    if (existingScript) {
      // Prefer an explicitly provided title; otherwise, keep the existing one.
      const newTitle = providedTitle?.trim() || existingScript.title;

      existingScript.title = newTitle ?? null;
      existingScript.message_id = message_id ?? existingScript.message_id;
      existingScript.voice_id = voice_id ?? existingScript.voice_id;

      const updatedScript = await this.scriptRepository.save(existingScript);

      if (sentences && sentences.length > 0) {
        // Replace existing sentences with the new ones
        await this.sentenceRepository.delete({ script_id: updatedScript.id });

        const sentenceEntities = sentences.map((s, index) =>
          this.sentenceRepository.create({
            text: s.text,
            index,
            script_id: updatedScript.id,
            image_id: s.image_id ?? null,
          }),
        );

        await this.sentenceRepository.save(sentenceEntities);
      }

      return this.findOne(updatedScript.id, userId);
    }

    const title =
      (providedTitle && providedTitle.trim()) ||
      (await this.aiService.generateTitleForScript(trimmedScript));

    const scriptEntity = this.scriptRepository.create({
      script: trimmedScript,
      user_id: userId,
      message_id: message_id ?? null,
      voice_id: voice_id ?? null,
      title: title || null,
    });

    const savedScript = await this.scriptRepository.save(scriptEntity);

    if (sentences && sentences.length > 0) {
      const sentenceEntities = sentences.map((s, index) =>
        this.sentenceRepository.create({
          text: s.text,
          index,
          script_id: savedScript.id,
          image_id: s.image_id ?? null,
        }),
      );

      await this.sentenceRepository.save(sentenceEntities);
    }

    return this.findOne(savedScript.id, userId);
  }

  async findAllByUser(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{ items: Script[]; total: number; page: number; limit: number }> {
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit =
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 50) : 20;

    const [items, total] = await this.scriptRepository.findAndCount({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
      relations: ['sentences', 'sentences.image', 'voice'],
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return { items, total, page: safePage, limit: safeLimit };
  }

  async findOne(id: string, userId: string): Promise<Script> {
    const script = await this.scriptRepository.findOne({
      where: { id, user_id: userId },
      relations: ['sentences', 'sentences.image', 'voice'],
    });

    if (!script) {
      throw new NotFoundException('Script not found');
    }

    return script;
  }
}
