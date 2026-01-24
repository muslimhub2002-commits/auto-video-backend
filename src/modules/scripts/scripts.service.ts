import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Script } from './entities/script.entity';
import { Sentence } from './entities/sentence.entity';
import { CreateScriptDto } from './dto/create-script.dto';
import { UpdateScriptDto } from './dto/update-script.dto';
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

        let suspenseAlreadyUsed = false;
        const sentenceEntities = sentences.map((s, index) => {
          const wantsSuspense = Boolean(s.isSuspense);
          const isSuspense = wantsSuspense && !suspenseAlreadyUsed;
          if (isSuspense) suspenseAlreadyUsed = true;

          return this.sentenceRepository.create({
            text: s.text,
            index,
            script_id: updatedScript.id,
            image_id: s.image_id ?? null,
            isSuspense,
          });
        });

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
      let suspenseAlreadyUsed = false;
      const sentenceEntities = sentences.map((s, index) => {
        const wantsSuspense = Boolean(s.isSuspense);
        const isSuspense = wantsSuspense && !suspenseAlreadyUsed;
        if (isSuspense) suspenseAlreadyUsed = true;

        return this.sentenceRepository.create({
          text: s.text,
          index,
          script_id: savedScript.id,
          image_id: s.image_id ?? null,
          isSuspense,
        });
      });

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

    // Use an explicit QueryBuilder so we can guarantee selecting `image.prompt`
    // even if the Image entity later marks it as `select: false`.
    const items = await this.scriptRepository
      .createQueryBuilder('script')
      .leftJoinAndSelect('script.sentences', 'sentence')
      .leftJoinAndSelect('sentence.image', 'image')
      .leftJoinAndSelect('script.voice', 'voice')
      .addSelect('image.prompt')
      .where('script.user_id = :userId', { userId })
      .orderBy('script.created_at', 'DESC')
      .addOrderBy('sentence.index', 'ASC')
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit)
      .getMany();

    // Count without joins to avoid inflated totals from 1:N sentence joins.
    const total = await this.scriptRepository.count({ where: { user_id: userId } });

    return { items, total, page: safePage, limit: safeLimit };
  }

  async findOne(id: string, userId: string): Promise<Script> {
    const script = await this.scriptRepository
      .createQueryBuilder('script')
      .leftJoinAndSelect('script.sentences', 'sentence')
      .leftJoinAndSelect('sentence.image', 'image')
      .leftJoinAndSelect('script.voice', 'voice')
      .addSelect('image.prompt')
      .where('script.id = :id', { id })
      .andWhere('script.user_id = :userId', { userId })
      .orderBy('sentence.index', 'ASC')
      .getOne();

    if (!script) {
      throw new NotFoundException('Script not found');
    }

    return script;
  }

  async update(id: string, userId: string, dto: UpdateScriptDto): Promise<Script> {
    const script = await this.scriptRepository.findOne({
      where: { id, user_id: userId },
      relations: ['sentences'],
    });

    if (!script) {
      throw new NotFoundException('Script not found');
    }

    if (dto.script !== undefined) {
      const trimmedScript = (dto.script ?? '').trim();
      script.script = trimmedScript;
    }

    if (dto.title !== undefined) {
      const trimmedTitle = (dto.title ?? '').trim();
      script.title = trimmedTitle ? trimmedTitle : null;
    }

    if (dto.voice_id !== undefined) {
      script.voice_id = dto.voice_id ?? null;
    }

    await this.scriptRepository.save(script);

    if (dto.sentences !== undefined) {
      await this.sentenceRepository.delete({ script_id: script.id });

      if (dto.sentences.length > 0) {
        let suspenseAlreadyUsed = false;
        const sentenceEntities = dto.sentences.map((s, index) => {
          const wantsSuspense = Boolean(s.isSuspense);
          const isSuspense = wantsSuspense && !suspenseAlreadyUsed;
          if (isSuspense) suspenseAlreadyUsed = true;

          return this.sentenceRepository.create({
            text: s.text,
            index,
            script_id: script.id,
            image_id: s.image_id ?? null,
            isSuspense,
          });
        });
        await this.sentenceRepository.save(sentenceEntities);
      }
    }

    return this.findOne(id, userId);
  }

  async remove(id: string, userId: string): Promise<{ deleted: true }> {
    const existing = await this.scriptRepository.findOne({
      where: { id, user_id: userId },
    });

    if (!existing) {
      throw new NotFoundException('Script not found');
    }

    await this.sentenceRepository.delete({ script_id: id });
    await this.scriptRepository.delete({ id, user_id: userId });
    return { deleted: true };
  }
}
