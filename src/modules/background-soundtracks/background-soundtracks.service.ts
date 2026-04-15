import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  OnModuleInit,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { BackgroundSoundtrack } from './entities/background-soundtrack.entity';
import {
  DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS,
  normalizeSoundEffectAudioSettings,
} from '../sound-effects/audio-settings.types';
import { UploadsService } from '../uploads/uploads.service';

@Injectable()
export class BackgroundSoundtracksService implements OnModuleInit {
  constructor(
    @InjectRepository(BackgroundSoundtrack)
    private readonly repo: Repository<BackgroundSoundtrack>,
    private readonly uploadsService: UploadsService,
  ) {}

  async onModuleInit() {
    await this.ensureBackgroundSoundtracksSchema();
  }

  private async ensureBackgroundSoundtracksSchema() {
    await this.repo.query(
      'ALTER TABLE background_soundtracks ADD COLUMN IF NOT EXISTS audio_settings JSONB NULL',
    );
    await this.repo.query(
      'ALTER TABLE background_soundtracks ADD COLUMN IF NOT EXISTS is_preset BOOLEAN NOT NULL DEFAULT FALSE',
    );
    await this.repo.query(
      'ALTER TABLE background_soundtracks ADD COLUMN IF NOT EXISTS source_soundtrack_id UUID NULL',
    );
  }

  private normalizeStoredSoundtrack(
    soundtrack: BackgroundSoundtrack,
  ): BackgroundSoundtrack {
    soundtrack.audio_settings = normalizeSoundEffectAudioSettings(
      soundtrack.audio_settings ?? DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS,
    );
    soundtrack.is_preset = Boolean(soundtrack.is_preset);
    soundtrack.source_soundtrack_id = soundtrack.source_soundtrack_id ?? null;
    return soundtrack;
  }

  private async findOwnedSoundtrackOrThrow(params: {
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

    return this.normalizeStoredSoundtrack(target);
  }

  private async assertTitleAvailable(params: {
    user_id: string;
    title: string;
    excludeId?: string;
  }) {
    const title = String(params.title ?? '').trim();
    if (!title) {
      throw new BadRequestException('Title is required');
    }

    const existing = await this.repo.findOne({
      where: { user_id: params.user_id, title },
    });

    if (existing && existing.id !== params.excludeId) {
      throw new BadRequestException(
        'A background soundtrack with this title already exists',
      );
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

    return {
      items: items.map((item) => this.normalizeStoredSoundtrack(item)),
      total,
      page: safePage,
      limit: safeLimit,
    };
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

    return this.normalizeStoredSoundtrack(updated);
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
    const volumePercent = Number.isFinite(raw)
      ? Math.max(0, Math.min(100, raw))
      : 100;

    const target = await this.repo.findOne({
      where: { id: soundtrackId, user_id: params.user_id },
    });

    if (!target) {
      throw new NotFoundException('Soundtrack not found');
    }

    target.volume_percent = volumePercent;
    target.audio_settings = normalizeSoundEffectAudioSettings(
      target.audio_settings ?? DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS,
    );
    return this.normalizeStoredSoundtrack(await this.repo.save(target));
  }

  async updateById(params: {
    user_id: string;
    soundtrackId: string;
    title: string;
    volumePercent?: number;
    audioSettings?: Record<string, unknown> | null;
  }): Promise<BackgroundSoundtrack> {
    const title = String(params.title ?? '').trim();
    if (!title) {
      throw new BadRequestException('Title is required');
    }

    const target = await this.findOwnedSoundtrackOrThrow(params);
    await this.assertTitleAvailable({
      user_id: params.user_id,
      title,
      excludeId: target.id,
    });

    const raw = Number(params.volumePercent);
    const volumePercent = Number.isFinite(raw)
      ? Math.max(0, Math.min(300, raw))
      : (target.volume_percent ?? 100);

    target.title = title;
    target.volume_percent = volumePercent;
    target.audio_settings = normalizeSoundEffectAudioSettings(
      params.audioSettings ??
        target.audio_settings ??
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS,
    );

    return this.normalizeStoredSoundtrack(await this.repo.save(target));
  }

  async saveAsPreset(params: {
    user_id: string;
    soundtrackId: string;
    title: string;
    volumePercent?: number;
    audioSettings?: Record<string, unknown> | null;
  }): Promise<BackgroundSoundtrack> {
    const source = await this.findOwnedSoundtrackOrThrow(params);
    const title = String(params.title ?? '').trim();
    if (!title) {
      throw new BadRequestException('Title is required');
    }

    await this.assertTitleAvailable({ user_id: params.user_id, title });

    const raw = Number(params.volumePercent);
    const volumePercent = Number.isFinite(raw)
      ? Math.max(0, Math.min(300, raw))
      : (source.volume_percent ?? 100);

    const clone = this.repo.create({
      user_id: source.user_id,
      title,
      url: source.url,
      public_id: source.public_id,
      hash: source.hash,
      number_of_times_used: 0,
      is_favorite: false,
      volume_percent: volumePercent,
      audio_settings: normalizeSoundEffectAudioSettings(
        params.audioSettings ??
          source.audio_settings ??
          DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS,
      ),
      is_preset: true,
      source_soundtrack_id: source.id,
    });

    return this.normalizeStoredSoundtrack(await this.repo.save(clone));
  }

  async deleteById(params: {
    user_id: string;
    soundtrackId: string;
  }): Promise<string> {
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

    const publicId = String((target as any)?.public_id ?? '').trim();
    if (publicId) {
      try {
        await this.uploadsService.deleteByRef({
          providerRef: publicId,
          resourceType: 'audio',
        });
      } catch (error) {
        console.error('Failed to delete soundtrack from managed upload', {
          soundtrackId,
          publicId,
          error,
        });
      }
    }

    await this.repo.delete({ id: target.id, user_id: params.user_id } as any);
    return target.id;
  }

  private async uploadAudioToManagedStorage(params: {
    buffer: Buffer;
    filename: string;
  }): Promise<{ url: string; public_id: string | null }> {
    const uploadResult = await this.uploadsService.uploadBuffer({
      buffer: params.buffer,
      filename: params.filename,
      folder: 'auto-video-generator/background-soundtracks',
      resourceType: 'audio',
    });

    return {
      url: uploadResult.url,
      public_id: uploadResult.providerRef,
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

      const uploaded = await this.uploadAudioToManagedStorage({
        buffer: params.buffer,
        filename: params.filename,
      });

      return { ...uploaded, hash };
    } catch (error: any) {
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
    volumePercent?: number;
    audioSettings?: Record<string, unknown> | null;
  }): Promise<BackgroundSoundtrack> {
    try {
      const title = String(params.title ?? '').trim();
      if (!title) {
        throw new BadRequestException('Title is required');
      }

      const hash = crypto
        .createHash('sha256')
        .update(params.buffer)
        .digest('hex');

      const existing = await this.repo.findOne({
        where: { user_id: params.user_id, hash },
      });

      const rawVolume = Number(params.volumePercent);
      const volumePercent = Number.isFinite(rawVolume)
        ? Math.max(0, Math.min(300, rawVolume))
        : 100;
      const audioSettings = normalizeSoundEffectAudioSettings(
        params.audioSettings ?? DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS,
      );

      if (existing) {
        await this.assertTitleAvailable({
          user_id: params.user_id,
          title,
          excludeId: existing.id,
        });
        existing.number_of_times_used += 1;
        existing.title = title;
        existing.volume_percent = volumePercent;
        existing.audio_settings = audioSettings;
        return this.normalizeStoredSoundtrack(await this.repo.save(existing));
      }

      await this.assertTitleAvailable({ user_id: params.user_id, title });

      const uploaded = await this.uploadAudioToManagedStorage({
        buffer: params.buffer,
        filename: params.filename,
      });

      const entity = this.repo.create({
        user_id: params.user_id,
        title,
        url: uploaded.url,
        public_id: uploaded.public_id,
        hash,
        number_of_times_used: 0,
        volume_percent: volumePercent,
        audio_settings: audioSettings,
        is_preset: false,
        source_soundtrack_id: null,
      });

      return this.normalizeStoredSoundtrack(await this.repo.save(entity));
    } catch (error: any) {
      console.error('Error in uploadAndCreate (background soundtrack):', error);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to save background soundtrack',
      );
    }
  }
}
