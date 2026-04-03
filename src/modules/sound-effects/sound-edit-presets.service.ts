import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import {
  DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS,
  normalizeSoundEffectAudioSettings,
} from './audio-settings.types';
import { SoundEditPreset } from './entities/sound-edit-preset.entity';
import { CreateSoundEditPresetDto } from './dto/create-sound-edit-preset.dto';
import { UpdateSoundEditPresetDto } from './dto/update-sound-edit-preset.dto';

const clampPercent = (value: number) => Math.max(0, Math.min(300, value));

@Injectable()
export class SoundEditPresetsService {
  constructor(
    @InjectRepository(SoundEditPreset)
    private readonly repo: Repository<SoundEditPreset>,
  ) {}

  private normalizeStoredPreset(entity: SoundEditPreset): SoundEditPreset {
    entity.title = String(entity?.title ?? '').trim() || 'Untitled preset';
    entity.volume_percent = clampPercent(Number(entity?.volume_percent ?? 100));
    entity.audio_settings = normalizeSoundEffectAudioSettings(
      entity.audio_settings ?? DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS,
    );
    return entity;
  }

  private async findOwnedPresetOrThrow(params: {
    user_id: string;
    presetId: string;
  }): Promise<SoundEditPreset> {
    const presetId = String(params.presetId ?? '').trim();
    if (!presetId) throw new NotFoundException('Sound edit preset not found');

    const preset = await this.repo.findOne({
      where: { id: presetId, user_id: params.user_id },
    });

    if (!preset) {
      throw new NotFoundException('Sound edit preset not found');
    }

    return preset;
  }

  private async assertTitleAvailable(params: {
    user_id: string;
    title: string;
    excludeId?: string | null;
  }): Promise<void> {
    const normalizedTitle = String(params.title ?? '').trim();
    if (!normalizedTitle) {
      throw new BadRequestException('Preset title is required');
    }

    const query = this.repo
      .createQueryBuilder('preset')
      .where('preset.user_id = :userId', { userId: params.user_id })
      .andWhere('LOWER(preset.title) = LOWER(:title)', {
        title: normalizedTitle,
      });

    const excludeId = String(params.excludeId ?? '').trim();
    if (excludeId) {
      query.andWhere('preset.id != :excludeId', { excludeId });
    }

    const existing = await query.getOne();
    if (existing) {
      throw new BadRequestException(
        'A sound edit preset with this title already exists',
      );
    }
  }

  async create(user_id: string, dto: CreateSoundEditPresetDto) {
    const title = String(dto?.title ?? '').trim();
    if (!title) {
      throw new BadRequestException('Preset title is required');
    }

    await this.assertTitleAvailable({ user_id, title });

    const entity = this.repo.create({
      user_id,
      title,
      volume_percent: clampPercent(Number(dto?.volumePercent ?? 100) || 100),
      audio_settings: normalizeSoundEffectAudioSettings(dto?.audioSettings),
    });

    return this.normalizeStoredPreset(await this.repo.save(entity));
  }

  async findAllByUser(user_id: string, page = 1, limit = 20, q?: string) {
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 20) : 20;
    const search = String(q ?? '').trim();

    const where = search
      ? [{ user_id, title: ILike(`%${search}%`) }]
      : { user_id };

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { updated_at: 'DESC', created_at: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return {
      items: items.map((item) => this.normalizeStoredPreset(item)),
      total,
      page: safePage,
      limit: safeLimit,
    };
  }

  async update(params: {
    user_id: string;
    presetId: string;
    dto: UpdateSoundEditPresetDto;
  }) {
    const preset = await this.findOwnedPresetOrThrow({
      user_id: params.user_id,
      presetId: params.presetId,
    });

    if (params.dto?.title !== undefined) {
      const title = String(params.dto.title ?? '').trim();
      if (!title) {
        throw new BadRequestException('Preset title is required');
      }
      await this.assertTitleAvailable({
        user_id: params.user_id,
        title,
        excludeId: preset.id,
      });
      preset.title = title;
    }

    if (params.dto?.volumePercent !== undefined) {
      preset.volume_percent = clampPercent(
        Number(params.dto.volumePercent ?? 100) || 100,
      );
    }

    if (params.dto?.audioSettings !== undefined) {
      preset.audio_settings = normalizeSoundEffectAudioSettings(
        params.dto.audioSettings,
      );
    }

    return this.normalizeStoredPreset(await this.repo.save(preset));
  }

  async remove(params: { user_id: string; presetId: string }) {
    const preset = await this.findOwnedPresetOrThrow(params);
    await this.repo.delete({ id: preset.id, user_id: params.user_id });
    return { id: preset.id, deleted: true as const };
  }
}