import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Video } from '../videos/entities/video.entity';

@Injectable()
export class VideosLibraryService {
  constructor(
    @InjectRepository(Video)
    private readonly videosRepository: Repository<Video>,
  ) {}

  async findAllByUser(
    user_id: string,
    page = 1,
    limit = 20,
  ): Promise<{ items: Video[]; total: number; page: number; limit: number }> {
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 50) : 20;

    // Only include videos that are actually referenced by a sentence (sentences.video_id).
    // This ensures the "Video Library" contains only sentence-generated/saved videos.
    const sentenceVideoIdsSubquery = this.videosRepository
      .createQueryBuilder('v')
      .subQuery()
      .select('s.video_id')
      .from('sentences', 's')
      .innerJoin('scripts', 'sc', 'sc.id = s.script_id')
      .where('sc.user_id = :user_id', { user_id })
      .andWhere('s.video_id IS NOT NULL')
      .groupBy('s.video_id')
      .getQuery();

    const qb = this.videosRepository
      .createQueryBuilder('v')
      .where('v.user_id = :user_id', { user_id })
      .andWhere(`v.id IN ${sentenceVideoIdsSubquery}`)
      .orderBy('v.created_at', 'DESC')
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit);

    const [items, total] = await qb.getManyAndCount();

    return { items, total, page: safePage, limit: safeLimit };
  }
}
