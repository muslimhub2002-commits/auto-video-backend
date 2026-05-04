import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import {
  SavedSequence,
  SavedSequenceSceneSnapshot,
  SavedSequenceSoundEffectSnapshot,
  SavedSequenceTransitionSoundEffectSnapshot,
} from './entities/saved-sequence.entity';
import { CreateSavedSequenceDto } from './dto/create-saved-sequence.dto';
import { UpdateSavedSequenceDto } from './dto/update-saved-sequence.dto';
import {
  SAVED_SEQUENCE_IMAGE_EFFECTS_MODES,
  SAVED_SEQUENCE_IMAGE_MOTION_EFFECTS,
  SAVED_SEQUENCE_SCENE_TABS,
  SAVED_SEQUENCE_TEXT_ANIMATION_EFFECTS,
  SAVED_SEQUENCE_TRANSITIONS,
  SAVED_SEQUENCE_VIDEO_GENERATION_MODES,
  SAVED_SEQUENCE_VISUAL_EFFECTS,
} from './saved-sequence.constants';

const SCENE_TABS = new Set<string>(SAVED_SEQUENCE_SCENE_TABS);
const IMAGE_EFFECTS_MODES = new Set<string>(SAVED_SEQUENCE_IMAGE_EFFECTS_MODES);
const TRANSITIONS = new Set<string>(SAVED_SEQUENCE_TRANSITIONS);
const VISUAL_EFFECTS = new Set<string>(SAVED_SEQUENCE_VISUAL_EFFECTS);
const IMAGE_MOTION_EFFECTS = new Set<string>(SAVED_SEQUENCE_IMAGE_MOTION_EFFECTS);
const TEXT_ANIMATION_EFFECTS = new Set<string>(
  SAVED_SEQUENCE_TEXT_ANIMATION_EFFECTS,
);
const VIDEO_GENERATION_MODES = new Set<string>(
  SAVED_SEQUENCE_VIDEO_GENERATION_MODES,
);

@Injectable()
export class SavedSequencesService {
  constructor(
    @InjectRepository(SavedSequence)
    private readonly repo: Repository<SavedSequence>,
  ) {}

  private normalizeTitle(value: unknown): string {
    const title = String(value ?? '').trim();
    if (!title) {
      throw new BadRequestException('Sequence title is required');
    }
    return title;
  }

  private normalizeString(value: unknown): string | null {
    const next = String(value ?? '').trim();
    return next || null;
  }

  private normalizeSettingsObject(
    value: unknown,
  ): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private normalizeNumber(
    value: unknown,
    params: { min?: number; max?: number; fallback: number | null },
  ): number | null {
    if (value === null || value === undefined || value === '') {
      return params.fallback;
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return params.fallback;
    }

    let next = numeric;
    if (typeof params.min === 'number') {
      next = Math.max(params.min, next);
    }
    if (typeof params.max === 'number') {
      next = Math.min(params.max, next);
    }
    return next;
  }

  private normalizeBoolean(value: unknown, fallback = false): boolean {
    return typeof value === 'boolean' ? value : fallback;
  }

  private normalizeSoundEffectSnapshot(
    value: unknown,
  ): SavedSequenceSoundEffectSnapshot | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const item = value as Record<string, unknown>;
    const soundEffectId = this.normalizeString(item.sound_effect_id);
    if (!soundEffectId) {
      return null;
    }

    const title = this.normalizeString(item.title);
    const url = this.normalizeString(item.url);

    return {
      sound_effect_id: soundEffectId,
      title: title ?? undefined,
      url: url ?? undefined,
      delay_seconds: this.normalizeNumber(item.delay_seconds, {
        min: 0,
        fallback: 0,
      }) ?? 0,
      volume_percent: this.normalizeNumber(item.volume_percent, {
        min: 0,
        max: 300,
        fallback: 100,
      }) ?? 100,
      timing_mode:
        item.timing_mode === 'after_previous_ends'
          ? 'after_previous_ends'
          : 'with_previous',
      audio_settings: this.normalizeSettingsObject(item.audio_settings),
      default_audio_settings: this.normalizeSettingsObject(
        item.default_audio_settings,
      ),
      duration_seconds: this.normalizeNumber(item.duration_seconds, {
        min: 0,
        fallback: null,
      }),
    };
  }

  private normalizeSoundEffectSnapshots(
    value: unknown,
  ): SavedSequenceSoundEffectSnapshot[] | null {
    if (!Array.isArray(value)) {
      return null;
    }

    const items = value
      .map((item) => this.normalizeSoundEffectSnapshot(item))
      .filter(
        (item): item is SavedSequenceSoundEffectSnapshot => item !== null,
      );

    return items.length > 0 ? items : null;
  }

  private normalizeTransitionSoundEffectSnapshot(
    value: unknown,
  ): SavedSequenceTransitionSoundEffectSnapshot | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const item = value as Record<string, unknown>;
    const soundEffectId = this.normalizeString(item.sound_effect_id);
    if (!soundEffectId) {
      return null;
    }

    const title = this.normalizeString(item.title);
    const url = this.normalizeString(item.url);

    return {
      sound_effect_id: soundEffectId,
      title: title ?? undefined,
      url: url ?? undefined,
      delay_seconds: this.normalizeNumber(item.delay_seconds, {
        min: 0,
        fallback: 0,
      }) ?? 0,
      volume_percent: this.normalizeNumber(item.volume_percent, {
        min: 0,
        max: 300,
        fallback: 100,
      }) ?? 100,
      audio_settings: this.normalizeSettingsObject(item.audio_settings),
    };
  }

  private normalizeTransitionSoundEffectSnapshots(
    value: unknown,
  ): SavedSequenceTransitionSoundEffectSnapshot[] | null {
    if (!Array.isArray(value)) {
      return null;
    }

    const items = value
      .map((item) => this.normalizeTransitionSoundEffectSnapshot(item))
      .filter(
        (item): item is SavedSequenceTransitionSoundEffectSnapshot =>
          item !== null,
      );

    return items.length > 0 ? items : null;
  }

  private normalizeSceneSnapshot(
    value: unknown,
  ): SavedSequenceSceneSnapshot | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const scene = value as Record<string, unknown>;
    const sceneTabRaw = this.normalizeString(scene.scene_tab);
    const sceneTab = sceneTabRaw && SCENE_TABS.has(sceneTabRaw)
      ? sceneTabRaw
      : 'image';

    const imageEffectsModeRaw = this.normalizeString(scene.image_effects_mode);
    const imageEffectsMode =
      imageEffectsModeRaw && IMAGE_EFFECTS_MODES.has(imageEffectsModeRaw)
        ? imageEffectsModeRaw
        : 'quick';

    const visualEffectRaw = this.normalizeString(scene.visual_effect);
    const visualEffect =
      visualEffectRaw &&
      VISUAL_EFFECTS.has(visualEffectRaw) &&
      visualEffectRaw !== 'none'
        ? visualEffectRaw
        : null;

    const imageMotionEffectRaw = this.normalizeString(
      scene.image_motion_effect,
    );
    const imageMotionEffect =
      imageMotionEffectRaw && IMAGE_MOTION_EFFECTS.has(imageMotionEffectRaw)
        ? imageMotionEffectRaw
        : 'default';

    const textAnimationEffectRaw = this.normalizeString(
      scene.text_animation_effect,
    );
    const textAnimationEffect =
      textAnimationEffectRaw &&
      TEXT_ANIMATION_EFFECTS.has(textAnimationEffectRaw)
        ? textAnimationEffectRaw
        : null;

    const transitionToNextRaw = this.normalizeString(scene.transition_to_next);
    const transitionToNext =
      transitionToNextRaw && TRANSITIONS.has(transitionToNextRaw)
        ? transitionToNextRaw
        : null;

    const videoGenerationModeRaw = this.normalizeString(
      scene.video_generation_mode,
    );
    const videoGenerationMode =
      videoGenerationModeRaw &&
      VIDEO_GENERATION_MODES.has(videoGenerationModeRaw)
        ? videoGenerationModeRaw
        : 'referenceImage';

    return {
      scene_tab: sceneTab as SavedSequenceSceneSnapshot['scene_tab'],
      image_effects_mode:
        imageEffectsMode as SavedSequenceSceneSnapshot['image_effects_mode'],
      align_sound_effects_to_scene_end: this.normalizeBoolean(
        scene.align_sound_effects_to_scene_end,
        false,
      ),
      visual_effect:
        visualEffect as SavedSequenceSceneSnapshot['visual_effect'],
      custom_image_filter_id: this.normalizeString(
        scene.custom_image_filter_id,
      ),
      image_filter_settings: this.normalizeSettingsObject(
        scene.image_filter_settings,
      ),
      image_motion_effect:
        imageMotionEffect as SavedSequenceSceneSnapshot['image_motion_effect'],
      custom_motion_effect_id: this.normalizeString(
        scene.custom_motion_effect_id,
      ),
      image_motion_settings: this.normalizeSettingsObject(
        scene.image_motion_settings,
      ),
      image_motion_speed: this.normalizeNumber(scene.image_motion_speed, {
        min: 0.5,
        max: 2.5,
        fallback: null,
      }),
      video_generation_mode:
        videoGenerationMode as SavedSequenceSceneSnapshot['video_generation_mode'],
      text_animation_effect:
        textAnimationEffect as SavedSequenceSceneSnapshot['text_animation_effect'],
      text_animation_settings: this.normalizeSettingsObject(
        scene.text_animation_settings,
      ),
      text_animation_sound_effects: this.normalizeSoundEffectSnapshots(
        scene.text_animation_sound_effects,
      ),
      overlay_url: this.normalizeString(scene.overlay_url),
      overlay_mime_type: this.normalizeString(scene.overlay_mime_type),
      overlay_settings: this.normalizeSettingsObject(scene.overlay_settings),
      overlay_sound_effects: this.normalizeSoundEffectSnapshots(
        scene.overlay_sound_effects,
      ),
      sound_effects: this.normalizeSoundEffectSnapshots(scene.sound_effects),
      transition_to_next:
        transitionToNext as SavedSequenceSceneSnapshot['transition_to_next'],
      transition_sound_effects: this.normalizeTransitionSoundEffectSnapshots(
        scene.transition_sound_effects,
      ),
      is_suspense: this.normalizeBoolean(scene.is_suspense, false),
    };
  }

  private normalizeSceneSnapshots(
    value: unknown,
  ): SavedSequenceSceneSnapshot[] {
    if (!Array.isArray(value)) {
      throw new BadRequestException('At least one scene snapshot is required');
    }

    const scenes = value
      .map((item) => this.normalizeSceneSnapshot(item))
      .filter((item): item is SavedSequenceSceneSnapshot => item !== null);

    if (scenes.length === 0) {
      throw new BadRequestException('At least one scene snapshot is required');
    }

    return scenes;
  }

  private normalizeStoredSequence(entity: SavedSequence): SavedSequence {
    entity.title = this.normalizeTitle(entity.title);
    entity.scenes = this.normalizeSceneSnapshots(entity.scenes);
    return entity;
  }

  private toSummary(entity: SavedSequence) {
    return {
      id: entity.id,
      title: entity.title,
      scene_count: Array.isArray(entity.scenes) ? entity.scenes.length : 0,
      created_at: entity.created_at,
      updated_at: entity.updated_at,
    };
  }

  private toDetail(entity: SavedSequence) {
    return {
      ...this.toSummary(entity),
      user_id: entity.user_id,
      scenes: entity.scenes,
    };
  }

  private async findOwnedSequenceOrThrow(params: {
    user_id: string;
    savedSequenceId: string;
  }): Promise<SavedSequence> {
    const savedSequenceId = String(params.savedSequenceId ?? '').trim();
    if (!savedSequenceId) {
      throw new NotFoundException('Saved sequence not found');
    }

    const sequence = await this.repo.findOne({
      where: { id: savedSequenceId, user_id: params.user_id },
    });

    if (!sequence) {
      throw new NotFoundException('Saved sequence not found');
    }

    return this.normalizeStoredSequence(sequence);
  }

  private async assertTitleAvailable(params: {
    user_id: string;
    title: string;
    excludeId?: string | null;
  }): Promise<void> {
    const title = this.normalizeTitle(params.title);
    const query = this.repo
      .createQueryBuilder('savedSequence')
      .where('savedSequence.user_id = :userId', { userId: params.user_id })
      .andWhere('LOWER(savedSequence.title) = LOWER(:title)', { title });

    const excludeId = this.normalizeString(params.excludeId);
    if (excludeId) {
      query.andWhere('savedSequence.id != :excludeId', { excludeId });
    }

    const existing = await query.getOne();
    if (existing) {
      throw new BadRequestException(
        'A saved sequence with this title already exists',
      );
    }
  }

  async create(user_id: string, dto: CreateSavedSequenceDto) {
    const title = this.normalizeTitle(dto?.title);
    await this.assertTitleAvailable({ user_id, title });

    const entity = this.repo.create({
      user_id,
      title,
      scenes: this.normalizeSceneSnapshots(dto?.scenes),
    });

    return this.toDetail(this.normalizeStoredSequence(await this.repo.save(entity)));
  }

  async findAllByUser(user_id: string, page = 1, limit = 20, q?: string) {
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit =
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 50) : 20;
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
      items: items.map((item) => this.toSummary(this.normalizeStoredSequence(item))),
      total,
      page: safePage,
      limit: safeLimit,
    };
  }

  async findOneByUser(params: { user_id: string; savedSequenceId: string }) {
    return this.toDetail(await this.findOwnedSequenceOrThrow(params));
  }

  async update(params: {
    user_id: string;
    savedSequenceId: string;
    dto: UpdateSavedSequenceDto;
  }) {
    const sequence = await this.findOwnedSequenceOrThrow({
      user_id: params.user_id,
      savedSequenceId: params.savedSequenceId,
    });

    if (params.dto?.title !== undefined) {
      const title = this.normalizeTitle(params.dto.title);
      await this.assertTitleAvailable({
        user_id: params.user_id,
        title,
        excludeId: sequence.id,
      });
      sequence.title = title;
    }

    return this.toDetail(
      this.normalizeStoredSequence(await this.repo.save(sequence)),
    );
  }

  async remove(params: { user_id: string; savedSequenceId: string }) {
    const sequence = await this.findOwnedSequenceOrThrow(params);
    await this.repo.delete({ id: sequence.id, user_id: params.user_id });
    return { id: sequence.id, deleted: true as const };
  }
}