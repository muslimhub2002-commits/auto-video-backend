import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Script } from './entities/script.entity';
import { ScriptTemplate } from './entities/script-template.entity';
import { CreateScriptTemplateDto } from './dto/create-script-template.dto';
import { UpdateScriptTemplateDto } from './dto/update-script-template.dto';

@Injectable()
export class ScriptTemplatesService {
  constructor(
    @InjectRepository(ScriptTemplate)
    private readonly templateRepository: Repository<ScriptTemplate>,
    @InjectRepository(Script)
    private readonly scriptRepository: Repository<Script>,
  ) {}

  private async loadUserScripts(
    userId: string,
    scriptIds: string[],
  ): Promise<Script[]> {
    const uniqueIds = Array.from(new Set((scriptIds ?? []).filter(Boolean)));
    if (uniqueIds.length === 0) return [];

    const scripts = await this.scriptRepository.find({
      where: {
        id: In(uniqueIds),
        user_id: userId,
      },
      relations: [
        'sentences',
        'sentences.image',
        'sentences.startFrameImage',
        'sentences.endFrameImage',
        'sentences.video',
        'voice',
      ],
    });

    if (scripts.length !== uniqueIds.length) {
      throw new BadRequestException('One or more scriptIds are invalid');
    }

    return scripts;
  }

  async create(
    userId: string,
    dto: CreateScriptTemplateDto,
  ): Promise<ScriptTemplate> {
    const title = (dto.title ?? '').trim();
    if (!title) throw new BadRequestException('title is required');

    const scripts = await this.loadUserScripts(userId, dto.scriptIds ?? []);

    const entity = this.templateRepository.create({
      title,
      description: dto.description?.trim() ? dto.description.trim() : null,
      user_id: userId,
      scripts,
    });

    const saved = await this.templateRepository.save(entity);
    return this.findOne(saved.id, userId);
  }

  async findAllByUser(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{
    items: ScriptTemplate[];
    total: number;
    page: number;
    limit: number;
  }> {
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit =
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 50) : 20;

    const [items, total] = await this.templateRepository.findAndCount({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
      relations: [
        'scripts',
        'scripts.sentences',
        'scripts.sentences.image',
        'scripts.voice',
      ],
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return { items, total, page: safePage, limit: safeLimit };
  }

  async findOne(id: string, userId: string): Promise<ScriptTemplate> {
    const template = await this.templateRepository.findOne({
      where: { id, user_id: userId },
      relations: [
        'scripts',
        'scripts.sentences',
        'scripts.sentences.image',
        'scripts.voice',
      ],
    });

    if (!template) throw new NotFoundException('Template not found');

    return template;
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateScriptTemplateDto,
  ): Promise<ScriptTemplate> {
    const existing = await this.templateRepository.findOne({
      where: { id, user_id: userId },
      relations: ['scripts'],
    });

    if (!existing) throw new NotFoundException('Template not found');

    if (dto.title !== undefined) {
      const title = (dto.title ?? '').trim();
      existing.title = title ? title : existing.title;
    }

    if (dto.description !== undefined) {
      const desc = (dto.description ?? '').trim();
      existing.description = desc ? desc : null;
    }

    if (dto.scriptIds !== undefined) {
      existing.scripts = await this.loadUserScripts(
        userId,
        dto.scriptIds ?? [],
      );
    }

    await this.templateRepository.save(existing);
    return this.findOne(id, userId);
  }

  async remove(id: string, userId: string): Promise<{ deleted: true }> {
    const existing = await this.templateRepository.findOne({
      where: { id, user_id: userId },
    });

    if (!existing) throw new NotFoundException('Template not found');

    await this.templateRepository.delete({ id, user_id: userId });
    return { deleted: true };
  }
}
