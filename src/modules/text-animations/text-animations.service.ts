import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { normalizeSoundEffectAudioSettings } from '../sound-effects/audio-settings.types';
import { SoundEffect } from '../sound-effects/entities/sound-effect.entity';
import { Sentence } from '../scripts/entities/sentence.entity';
import { TextAnimation } from './entities/text-animation.entity';

type TextAnimationSoundEffectInput = Partial<
  NonNullable<TextAnimation['sound_effects']>[number]
> &
  Record<string, unknown>;

type TextAnimationSoundEffectRow = NonNullable<
  TextAnimation['sound_effects']
>[number];

const ALLOWED_TEXT_ANIMATION_EFFECTS: ReadonlySet<string> = new Set([
  'popInBounceHook',
  'slideCutFast',
  'scalePunchZoom',
  'maskReveal',
  'glitchFlashHook',
  'kineticTypography',
  'softRiseFade',
  'centerWipeReveal',
  'trackingSnapHook',
] as const);

type SyncLinkedTextAnimationSentencesParams = {
  textAnimationId: string;
  settings?: Record<string, unknown>;
  sound_effects?: Array<TextAnimationSoundEffectRow> | null;
};

@Injectable()
export class TextAnimationsService implements OnModuleInit {
  private schemaEnsuring: Promise<void> | null = null;
  private schemaEnsured = false;

  constructor(
    @InjectRepository(TextAnimation)
    private readonly repo: Repository<TextAnimation>,
    @InjectRepository(SoundEffect)
    private readonly soundEffectRepo: Repository<SoundEffect>,
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
          'ALTER TABLE text_animations ADD COLUMN IF NOT EXISTS sound_effects JSONB NULL',
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '';
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
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private normalizeTextAnimationEffect(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!ALLOWED_TEXT_ANIMATION_EFFECTS.has(normalized)) {
      return null;
    }

    return normalized;
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
  ): Array<TextAnimationSoundEffectInput> | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;

    let nextValue: unknown = value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;

      try {
        nextValue = JSON.parse(trimmed) as unknown;
      } catch {
        return null;
      }
    }

    if (!Array.isArray(nextValue)) {
      return null;
    }

    return nextValue.filter(
      (item): item is TextAnimationSoundEffectInput =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item),
    );
  }

  private async normalizeSoundEffectsForUser(params: {
    user_id: string;
    sound_effects: unknown;
  }): Promise<Array<TextAnimationSoundEffectRow> | null | undefined> {
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

  private async syncLinkedSentences(
    sentenceRepo: Repository<Sentence>,
    params: SyncLinkedTextAnimationSentencesParams,
  ): Promise<void> {
    const sentencePatch: {
      text_animation_effect?: string | null;
      text_animation_settings?: Record<string, unknown> | null;
      text_animation_sound_effects?: Sentence['text_animation_sound_effects'];
    } = {};

    if (params.settings !== undefined) {
      const normalizedSettings = params.settings
        ? this.normalizeSettings(params.settings)
        : null;
      sentencePatch.text_animation_effect =
        this.normalizeTextAnimationEffect(normalizedSettings?.presetKey) ??
        'slideCutFast';
      sentencePatch.text_animation_settings = normalizedSettings;
    }

    if (params.sound_effects !== undefined) {
      sentencePatch.text_animation_sound_effects = params.sound_effects ?? null;
    }

    if (Object.keys(sentencePatch).length === 0) {
      return;
    }

    await sentenceRepo.update(
      { text_animation_id: params.textAnimationId } as any,
      sentencePatch as any,
    );
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
    await this.ensureSchema();

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
    sound_effects?: unknown;
  }): Promise<TextAnimation> {
    await this.ensureSchema();

    const entity = this.repo.create({
      user_id: params.user_id,
      title: String(params.title ?? '').trim(),
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
    textAnimationId: string;
    title?: string;
    settings?: Record<string, unknown>;
    sound_effects?: unknown;
  }): Promise<TextAnimation> {
    await this.ensureSchema();

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
    if (params.sound_effects !== undefined) {
      target.sound_effects =
        (await this.normalizeSoundEffectsForUser({
          user_id: params.user_id,
          sound_effects: params.sound_effects,
        })) ?? null;
    }

    return this.dataSource.transaction(async (manager) => {
      const saved = await manager.getRepository(TextAnimation).save(target);

      await this.syncLinkedSentences(manager.getRepository(Sentence), {
        textAnimationId: saved.id,
        settings: params.settings !== undefined ? saved.settings : undefined,
        sound_effects:
          params.sound_effects !== undefined
            ? (saved.sound_effects ?? null)
            : undefined,
      });

      return saved;
    });
  }

  async deleteById(params: {
    user_id: string;
    textAnimationId: string;
  }): Promise<string> {
    await this.ensureSchema();

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
