import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MotionEffect } from './entities/motion-effect.entity';

@Injectable()
export class MotionEffectsService {
  constructor(
    @InjectRepository(MotionEffect)
    private readonly repo: Repository<MotionEffect>,
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
    items: MotionEffect[];
    total: number;
    page: number;
    limit: number;
  }> {
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit =
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 50;
    const search = String(q ?? '').trim().toLowerCase();

    const qb = this.repo
      .createQueryBuilder('motion_effect')
      .where('motion_effect.user_id = :user_id', { user_id });

    if (search) {
      qb.andWhere('LOWER(motion_effect.title) LIKE :search', {
        search: `%${search}%`,
      });
    }

    const [items, total] = await qb
      .orderBy('motion_effect.updated_at', 'DESC')
      .addOrderBy('motion_effect.created_at', 'DESC')
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit)
      .getManyAndCount();

    return { items, total, page: safePage, limit: safeLimit };
  }

  async createForUser(params: {
    user_id: string;
    title: string;
    settings?: Record<string, unknown>;
  }): Promise<MotionEffect> {
    const entity = this.repo.create({
      user_id: params.user_id,
      title: String(params.title ?? '').trim(),
      settings: this.normalizeSettings(params.settings),
    });

    return this.repo.save(entity);
  }

  async updateById(params: {
    user_id: string;
    motionEffectId: string;
    title?: string;
    settings?: Record<string, unknown>;
  }): Promise<MotionEffect> {
    const motionEffectId = String(params.motionEffectId ?? '').trim();
    if (!motionEffectId) {
      throw new NotFoundException('Motion effect not found');
    }

    const target = await this.repo.findOne({
      where: { id: motionEffectId, user_id: params.user_id },
    });
    if (!target) {
      throw new NotFoundException('Motion effect not found');
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
    motionEffectId: string;
  }): Promise<string> {
    const motionEffectId = String(params.motionEffectId ?? '').trim();
    if (!motionEffectId) {
      throw new NotFoundException('Motion effect not found');
    }

    const target = await this.repo.findOne({
      where: { id: motionEffectId, user_id: params.user_id },
    });
    if (!target) {
      throw new NotFoundException('Motion effect not found');
    }

    await this.repo.delete({ id: target.id, user_id: params.user_id } as any);
    return target.id;
  }
}