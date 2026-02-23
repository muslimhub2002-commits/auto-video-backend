import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v2 as cloudinary } from 'cloudinary';
import * as crypto from 'crypto';
import { BackgroundSoundtrack } from './entities/background-soundtrack.entity';

@Injectable()
export class BackgroundSoundtracksService {
  constructor(
    @InjectRepository(BackgroundSoundtrack)
    private readonly repo: Repository<BackgroundSoundtrack>,
  ) {
    if (
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_CLOUD_SECRET
    ) {
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_CLOUD_SECRET,
      });
    }
  }

  async findAllByUser(
    user_id: string,
    page = 1,
    limit = 50,
  ): Promise<{
    items: BackgroundSoundtrack[];
    total: number;
    page: number;
    limit: number;
  }> {
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit =
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 50;

    const [items, total] = await this.repo.findAndCount({
      where: { user_id },
      order: { is_favorite: 'DESC', created_at: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return { items, total, page: safePage, limit: safeLimit };
  }

  async setFavoriteById(params: {
    user_id: string;
    soundtrackId: string;
  }): Promise<BackgroundSoundtrack> {
    const soundtrackId = String(params.soundtrackId ?? '').trim();
    if (!soundtrackId) {
      throw new NotFoundException('Soundtrack not found');
    }

    const target = await this.repo.findOne({
      where: { id: soundtrackId, user_id: params.user_id },
    });

    if (!target) {
      throw new NotFoundException('Soundtrack not found');
    }

    await this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(BackgroundSoundtrack);

      await repo.update(
        { user_id: params.user_id, is_favorite: true },
        { is_favorite: false },
      );
      await repo.update(
        { id: target.id, user_id: params.user_id },
        { is_favorite: true },
      );
    });

    const updated = await this.repo.findOne({
      where: { id: target.id, user_id: params.user_id },
    });

    if (!updated) {
      throw new NotFoundException('Soundtrack not found after update');
    }

    return updated;
  }

  async setVolumeById(params: {
    user_id: string;
    soundtrackId: string;
    volumePercent: number;
  }): Promise<BackgroundSoundtrack> {
    const soundtrackId = String(params.soundtrackId ?? '').trim();
    if (!soundtrackId) {
      throw new NotFoundException('Soundtrack not found');
    }

    const raw = Number(params.volumePercent);
    const volumePercent = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 100;

    const target = await this.repo.findOne({
      where: { id: soundtrackId, user_id: params.user_id },
    });

    if (!target) {
      throw new NotFoundException('Soundtrack not found');
    }

    target.volume_percent = volumePercent;
    return this.repo.save(target);
  }

  private ensureCloudinaryConfigured() {
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_CLOUD_SECRET
    ) {
      throw new InternalServerErrorException(
        'Cloudinary environment variables are not configured',
      );
    }
  }

  private async uploadAudioToCloudinary(params: {
    buffer: Buffer;
    filename: string;
  }): Promise<{ url: string; public_id: string | null }> {
    this.ensureCloudinaryConfigured();

    const uploadResult: any = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'auto-video-generator/background-soundtracks',
          resource_type: 'video',
          overwrite: false,
        },
        (error, result) => {
          if (error || !result) {
            return reject(error ?? new Error('Cloudinary upload failed'));
          }
          resolve(result);
        },
      );

      stream.end(params.buffer);
    });

    return {
      url: uploadResult.secure_url,
      public_id: uploadResult.public_id ?? null,
    };
  }

  async uploadUseOnce(params: {
    buffer: Buffer;
    filename: string;
  }): Promise<{ url: string; public_id: string | null; hash: string }> {
    try {
      const hash = crypto
        .createHash('sha256')
        .update(params.buffer)
        .digest('hex');

      const uploaded = await this.uploadAudioToCloudinary({
        buffer: params.buffer,
        filename: params.filename,
      });

      return { ...uploaded, hash };
    } catch (error: any) {
      // eslint-disable-next-line no-console
      console.error('Error in uploadUseOnce (background soundtrack):', error);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to upload background soundtrack',
      );
    }
  }

  async uploadAndCreate(params: {
    buffer: Buffer;
    filename: string;
    title: string;
    user_id: string;
  }): Promise<BackgroundSoundtrack> {
    try {
      const hash = crypto
        .createHash('sha256')
        .update(params.buffer)
        .digest('hex');

      const existing = await this.repo.findOne({
        where: { user_id: params.user_id, hash },
      });

      if (existing) {
        existing.number_of_times_used += 1;
        if (params.title) existing.title = params.title;
        return this.repo.save(existing);
      }

      const uploaded = await this.uploadAudioToCloudinary({
        buffer: params.buffer,
        filename: params.filename,
      });

      const entity = this.repo.create({
        user_id: params.user_id,
        title: params.title,
        url: uploaded.url,
        public_id: uploaded.public_id,
        hash,
        number_of_times_used: 0,
      });

      return this.repo.save(entity);
    } catch (error: any) {
      // eslint-disable-next-line no-console
      console.error('Error in uploadAndCreate (background soundtrack):', error);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to save background soundtrack',
      );
    }
  }
}
