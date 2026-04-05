import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TextAnimation } from './entities/text-animation.entity';

@Injectable()
export class TextAnimationsService {
  constructor(
    @InjectRepository(TextAnimation)
    private readonly repo: Repository<TextAnimation>,
  ) {}

  private normalizeSettings(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  async findAllByUser(
    user_id: string,
    page = 1,
    limit = 50,
    q?: string,
  ): Promise<{
    items: TextAnimation[];
    total: number;
    page: number;
    limit: number;
  }> {
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit =
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 50;
    const search = String(q ?? '')
      .trim()
      .toLowerCase();

    const qb = this.repo
      .createQueryBuilder('text_animation')
      .where('text_animation.user_id = :user_id', { user_id });

    if (search) {
      qb.andWhere('LOWER(text_animation.title) LIKE :search', {
        search: `%${search}%`,
      });
    }

    const [items, total] = await qb
      .orderBy('text_animation.updated_at', 'DESC')
      .addOrderBy('text_animation.created_at', 'DESC')
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit)
      .getManyAndCount();

    return { items, total, page: safePage, limit: safeLimit };
  }

  async createForUser(params: {
    user_id: string;
    title: string;
    settings?: Record<string, unknown>;
  }): Promise<TextAnimation> {
    const entity = this.repo.create({
      user_id: params.user_id,
      title: String(params.title ?? '').trim(),
      settings: this.normalizeSettings(params.settings),
    });

    return this.repo.save(entity);
  }

  async updateById(params: {
    user_id: string;
    textAnimationId: string;
    title?: string;
    settings?: Record<string, unknown>;
  }): Promise<TextAnimation> {
    const textAnimationId = String(params.textAnimationId ?? '').trim();
    if (!textAnimationId) {
      throw new NotFoundException('Text animation preset not found');
    }

    const target = await this.repo.findOne({
      where: { id: textAnimationId, user_id: params.user_id },
    });
    if (!target) {
      throw new NotFoundException('Text animation preset not found');
    }

    if (params.title !== undefined) {
      target.title = String(params.title ?? '').trim() || target.title;
    }
    if (params.settings !== undefined) {
      target.settings = this.normalizeSettings(params.settings);
    }

    return this.repo.save(target);
  }

  async deleteById(params: {
    user_id: string;
    textAnimationId: string;
  }): Promise<string> {
    const textAnimationId = String(params.textAnimationId ?? '').trim();
    if (!textAnimationId) {
      throw new NotFoundException('Text animation preset not found');
    }

    const target = await this.repo.findOne({
      where: { id: textAnimationId, user_id: params.user_id },
    });
    if (!target) {
      throw new NotFoundException('Text animation preset not found');
    }

    await this.repo.delete({ id: target.id, user_id: params.user_id } as any);
    return target.id;
  }
}