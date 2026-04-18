import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { normalizeSoundEffectAudioSettings } from '../sound-effects/audio-settings.types';
import { SoundEffect } from '../sound-effects/entities/sound-effect.entity';
import { UploadsService } from '../uploads/uploads.service';
import { Overlay } from './entities/overlay.entity';

type OverlayUploadFile = {
  buffer: Buffer;
  originalname?: string;
  mimetype?: string;
};

type OverlaySoundEffectInput = Partial<
  NonNullable<Overlay['sound_effects']>[number]
> &
  Record<string, unknown>;

type OverlaySoundEffectRow = NonNullable<Overlay['sound_effects']>[number];

@Injectable()
export class OverlaysService implements OnModuleInit {
  private schemaEnsuring: Promise<void> | null = null;
  private schemaEnsured = false;

  constructor(
    @InjectRepository(Overlay)
    private readonly repo: Repository<Overlay>,
    @InjectRepository(SoundEffect)
    private readonly soundEffectRepo: Repository<SoundEffect>,
    private readonly uploadsService: UploadsService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
  }

  private async ensureSchema(): Promise<void> {
    if (this.schemaEnsured) return;
    if (this.schemaEnsuring) {
      await this.schemaEnsuring;
      return;
    }

    this.schemaEnsuring = (async () => {
      try {
        await this.dataSource.query(
          'ALTER TABLE overlays ADD COLUMN IF NOT EXISTS sound_effects JSONB NULL',
        );
      } catch (error: any) {
        const message = String(error?.message ?? '');
        if (
          message.includes('does not exist') ||
          message.includes('permission denied')
        ) {
          return;
        }

        throw error;
      } finally {
        this.schemaEnsured = true;
        this.schemaEnsuring = null;
      }
    })();

    await this.schemaEnsuring;
  }

  private normalizeSettings(value: unknown): Record<string, unknown> {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return {};

      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return {};
      }

      return {};
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private normalizeOptionalNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private normalizeTimingMode(
    value: unknown,
  ): 'with_previous' | 'after_previous_ends' {
    return value === 'after_previous_ends'
      ? 'after_previous_ends'
      : 'with_previous';
  }

  private parseSoundEffectsInput(
    value: unknown,
  ): Array<OverlaySoundEffectInput> | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;

    let nextValue = value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;

      try {
        nextValue = JSON.parse(trimmed);
      } catch {
        throw new BadRequestException('sound_effects must be valid JSON');
      }
    }

    if (!Array.isArray(nextValue)) {
      return null;
    }

    return nextValue.filter(
      (item): item is OverlaySoundEffectInput =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item),
    );
  }

  private async normalizeSoundEffectsForUser(params: {
    user_id: string;
    sound_effects: unknown;
  }): Promise<Array<OverlaySoundEffectRow> | null | undefined> {
    const items = this.parseSoundEffectsInput(params.sound_effects);
    if (items === undefined) return undefined;
    if (!items || items.length === 0) return null;

    const ids = items
      .map((item) => String(item.sound_effect_id ?? '').trim())
      .filter(Boolean);
    if (ids.length === 0) return null;

    const owned = await this.soundEffectRepo.find({
      where: { id: In(Array.from(new Set(ids))), user_id: params.user_id },
      select: {
        id: true,
        title: true,
        name: true,
        url: true,
        volume_percent: true,
        audio_settings: true,
        duration_seconds: true,
      },
    });
    const ownedById = new Map(
      owned.map((soundEffect) => [soundEffect.id, soundEffect]),
    );

    const normalized = items.flatMap((item) => {
      const soundEffectId = String(item.sound_effect_id ?? '').trim();
      const soundEffect = ownedById.get(soundEffectId);
      if (!soundEffect) return [];

      const volumePercentRaw = this.normalizeOptionalNumber(
        item.volume_percent,
      );
      const volumePercent =
        volumePercentRaw === null
          ? Math.max(
              0,
              Math.min(300, Number(soundEffect.volume_percent ?? 100) || 100),
            )
          : Math.max(0, Math.min(300, volumePercentRaw));
      const delaySeconds = Math.max(
        0,
        this.normalizeOptionalNumber(item.delay_seconds) ?? 0,
      );
      const durationSecondsRaw =
        typeof soundEffect.duration_seconds === 'number' &&
        Number.isFinite(soundEffect.duration_seconds)
          ? Math.max(0, soundEffect.duration_seconds)
          : null;
      const defaultAudioSettings = normalizeSoundEffectAudioSettings(
        soundEffect.audio_settings,
      );

      return [
        {
          sound_effect_id: soundEffect.id,
          title:
            String(item.title ?? '').trim() ||
            String(soundEffect.name ?? '').trim() ||
            String(soundEffect.title ?? '').trim() ||
            'Sound effect',
          url: String(soundEffect.url ?? '').trim(),
          delay_seconds: delaySeconds,
          volume_percent: volumePercent,
          timing_mode: this.normalizeTimingMode(item.timing_mode),
          audio_settings_override:
            item.audio_settings_override &&
            typeof item.audio_settings_override === 'object' &&
            !Array.isArray(item.audio_settings_override)
              ? normalizeSoundEffectAudioSettings(item.audio_settings_override)
              : null,
          default_audio_settings: defaultAudioSettings,
          duration_seconds: durationSecondsRaw,
        },
      ];
    });

    return normalized.length > 0 ? normalized : null;
  }

  private async resolveUpload(params: {
    file?: OverlayUploadFile | null;
    sourceUrl?: string | null;
  }): Promise<{
    url: string;
    providerRef: string | null;
    mimeType: string | null;
  }> {
    if (params.file?.buffer?.length) {
      const upload = await this.uploadsService.uploadBuffer({
        buffer: params.file.buffer,
        filename:
          String(params.file.originalname ?? 'overlay.mp4').trim() ||
          'overlay.mp4',
        mimeType: params.file.mimetype ?? null,
        folder: 'auto-video-generator/overlays',
        resourceType: 'video',
      });

      return {
        url: upload.url,
        providerRef: upload.providerRef,
        mimeType: String(params.file.mimetype ?? '').trim() || null,
      };
    }

    const sourceUrl = String(params.sourceUrl ?? '').trim();
    if (!sourceUrl) {
      throw new BadRequestException('Overlay file or sourceUrl is required');
    }

    const ensured = await this.uploadsService.ensurePublicUrl({
      sourceUrl,
      folder: 'auto-video-generator/overlays',
      resourceType: 'video',
    });

    return {
      url: ensured.url,
      providerRef: ensured.providerRef,
      mimeType: null,
    };
  }

  async findAllByUser(
    user_id: string,
    page = 1,
    limit = 50,
    q?: string,
  ): Promise<{
    items: Overlay[];
    total: number;
    page: number;
    limit: number;
  }> {
    await this.ensureSchema();

    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit =
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 50;
    const search = String(q ?? '')
      .trim()
      .toLowerCase();

    const qb = this.repo
      .createQueryBuilder('overlay')
      .where('overlay.user_id = :user_id', { user_id });

    if (search) {
      qb.andWhere('LOWER(overlay.title) LIKE :search', {
        search: `%${search}%`,
      });
    }

    const [items, total] = await qb
      .orderBy('overlay.updated_at', 'DESC')
      .addOrderBy('overlay.created_at', 'DESC')
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit)
      .getManyAndCount();

    return { items, total, page: safePage, limit: safeLimit };
  }

  async createForUser(params: {
    user_id: string;
    title: string;
    settings?: unknown;
    sourceUrl?: string | null;
    sound_effects?: unknown;
    file?: OverlayUploadFile | null;
  }): Promise<Overlay> {
    await this.ensureSchema();

    const upload = await this.resolveUpload({
      file: params.file,
      sourceUrl: params.sourceUrl,
    });

    const entity = this.repo.create({
      user_id: params.user_id,
      title: String(params.title ?? '').trim(),
      url: upload.url,
      public_id: upload.providerRef,
      mime_type: upload.mimeType,
      settings: this.normalizeSettings(params.settings),
      sound_effects:
        (await this.normalizeSoundEffectsForUser({
          user_id: params.user_id,
          sound_effects: params.sound_effects,
        })) ?? null,
    });

    return this.repo.save(entity);
  }

  async updateById(params: {
    user_id: string;
    overlayId: string;
    title?: string;
    settings?: unknown;
    sourceUrl?: string | null;
    sound_effects?: unknown;
    file?: OverlayUploadFile | null;
  }): Promise<Overlay> {
    await this.ensureSchema();

    const overlayId = String(params.overlayId ?? '').trim();
    if (!overlayId) {
      throw new NotFoundException('Overlay not found');
    }

    const target = await this.repo.findOne({
      where: { id: overlayId, user_id: params.user_id },
    });
    if (!target) {
      throw new NotFoundException('Overlay not found');
    }

    if (params.title !== undefined) {
      target.title = String(params.title ?? '').trim() || target.title;
    }
    if (params.settings !== undefined) {
      target.settings = this.normalizeSettings(params.settings);
    }
    if (params.sound_effects !== undefined) {
      target.sound_effects =
        (await this.normalizeSoundEffectsForUser({
          user_id: params.user_id,
          sound_effects: params.sound_effects,
        })) ?? null;
    }

    if (params.file?.buffer?.length || String(params.sourceUrl ?? '').trim()) {
      const previousProviderRef = String(target.public_id ?? '').trim() || null;
      const upload = await this.resolveUpload({
        file: params.file,
        sourceUrl: params.sourceUrl,
      });

      target.url = upload.url;
      target.public_id = upload.providerRef;
      target.mime_type = upload.mimeType;

      if (previousProviderRef && previousProviderRef !== upload.providerRef) {
        try {
          await this.uploadsService.deleteByRef({
            providerRef: previousProviderRef,
            resourceType: 'video',
          });
        } catch (error) {
          console.error('Failed to delete previous overlay asset', {
            overlayId,
            previousProviderRef,
            error,
          });
        }
      }
    }

    return this.repo.save(target);
  }

  async deleteById(params: {
    user_id: string;
    overlayId: string;
  }): Promise<string> {
    await this.ensureSchema();

    const overlayId = String(params.overlayId ?? '').trim();
    if (!overlayId) {
      throw new NotFoundException('Overlay not found');
    }

    const target = await this.repo.findOne({
      where: { id: overlayId, user_id: params.user_id },
    });
    if (!target) {
      throw new NotFoundException('Overlay not found');
    }

    const providerRef = String(target.public_id ?? '').trim() || null;
    if (providerRef) {
      try {
        await this.uploadsService.deleteByRef({
          providerRef,
          resourceType: 'video',
        });
      } catch (error) {
        console.error('Failed to delete overlay asset', {
          overlayId,
          providerRef,
          error,
        });
      }
    }

    await this.repo.delete({ id: target.id, user_id: params.user_id } as any);
    return target.id;
  }
}
