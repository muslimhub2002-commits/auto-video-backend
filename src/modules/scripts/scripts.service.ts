import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { extname, join, sep } from 'path';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Script } from './entities/script.entity';
import { Sentence } from './entities/sentence.entity';
import {
  SentenceSoundEffect,
  type SentenceSoundEffectTimingMode,
} from './entities/sentence-sound-effect.entity';
import { CreateScriptDto } from './dto/create-script.dto';
import { UpdateScriptDto } from './dto/update-script.dto';
import { AiService } from '../ai/ai.service';
import { Image } from '../images/entities/image.entity';
import {
  Video as VideoEntity,
  VideoSize,
} from '../videos/entities/video.entity';
import { UpdateSentenceMediaDto } from './dto/update-sentence-media.dto';
import { GenerateSentenceVideoDto } from './dto/generate-sentence-video.dto';
import { SaveSentenceVideoDto } from './dto/save-sentence-video.dto';
import { uploadBufferToCloudinary } from '../render-videos/utils/cloudinary.utils';
import { TranslateScriptDto } from './dto/translate-script.dto';
import { ScriptTranslationGroup } from './entities/script-translation-group.entity';
import { SoundEffect } from '../sound-effects/entities/sound-effect.entity';
import { normalizeSoundEffectAudioSettings } from '../sound-effects/audio-settings.types';

type UploadedImageFile = {
  buffer: Buffer;
  mimetype?: string;
  originalname?: string;
  size?: number;
};

type UploadedVideoFile = {
  buffer: Buffer;
  mimetype?: string;
  originalname?: string;
  size?: number;
};

type NormalizedVoiceOverChunk = {
  index: number;
  text: string;
  sentences: string[];
  provider: string | null;
  providerVoiceId: string | null;
  providerVoiceName: string | null;
  mimeType: string | null;
  styleInstructions: string | null;
  durationSeconds: number | null;
  estimatedSeconds: number | null;
  url: string;
  fileName: string | null;
  createdAt: string | null;
  elevenLabsSettings: NormalizedElevenLabsVoiceSettings | null;
};

type NormalizedVoiceGenerationConfig = {
  mode: 'auto' | 'perSentence';
  provider: 'google' | 'elevenlabs' | null;
  providerVoiceId: string | null;
  styleInstructions: string | null;
  elevenLabsSettings: NormalizedElevenLabsVoiceSettings | null;
};

type NormalizedElevenLabsVoiceSettings = {
  stability: number | null;
  similarityBoost: number | null;
  style: number | null;
  speed: number | null;
  useSpeakerBoost: boolean | null;
};

const ALLOWED_TEXT_ANIMATION_EFFECTS = new Set([
  'popInBounceHook',
  'slideCutFast',
  'scalePunchZoom',
  'maskReveal',
  'glitchFlashHook',
  'kineticTypography',
] as const);

@Injectable()
export class ScriptsService implements OnModuleInit {
  private scriptsSchemaEnsuring: Promise<void> | null = null;
  private scriptsSchemaEnsured = false;

  private normalizeImageEffectsMode(value: unknown): 'quick' | 'detailed' {
    return value === 'detailed' ? 'detailed' : 'quick';
  }

  private normalizeSceneTab(
    value: unknown,
  ): 'image' | 'video' | 'text' | 'overlay' | null {
    return value === 'video' ||
      value === 'text' ||
      value === 'image' ||
      value === 'overlay'
      ? value
      : null;
  }

  private normalizeOptionalId(value: unknown): string | null {
    const normalized = String(value ?? '').trim();
    return normalized || null;
  }

  private normalizeSettingsObject(
    value: unknown,
  ): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private normalizeImageMotionSpeed(value: unknown): number {
    const numeric = Number(value ?? 1);
    if (!Number.isFinite(numeric)) return 1;
    return Math.min(2.5, Math.max(0.5, numeric));
  }

  private normalizeTextAnimationEffect(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!ALLOWED_TEXT_ANIMATION_EFFECTS.has(normalized as any)) {
      return null;
    }

    return 'slideCutFast';
  }

  private normalizeTextAnimationSettingsObject(
    value: unknown,
  ): Record<string, unknown> | null {
    const normalized = this.normalizeSettingsObject(value);
    if (!normalized) {
      return null;
    }

    const next: Record<string, unknown> = { ...normalized };
    const presetKey = this.normalizeTextAnimationEffect(next.presetKey);
    if (presetKey) {
      next.presetKey = presetKey;
    } else {
      delete next.presetKey;
    }

    const contentAlign = String(next.contentAlign ?? '').trim();
    if (
      contentAlign === 'left' ||
      contentAlign === 'center' ||
      contentAlign === 'right'
    ) {
      next.contentAlign = contentAlign;
    } else {
      delete next.contentAlign;
    }

    next.animatePerWord = next.animatePerWord === true;

    const wordDelaySeconds = this.normalizeOptionalNumber(
      next.wordDelaySeconds,
    );
    if (wordDelaySeconds === null) {
      delete next.wordDelaySeconds;
    } else {
      next.wordDelaySeconds = Math.min(0.4, Math.max(0.03, wordDelaySeconds));
    }

    return next;
  }

  private normalizeTextAnimationText(value: unknown): string | null {
    const normalized = String(value ?? '').trim();
    return normalized || null;
  }

  private normalizeOptionalNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private normalizeVoiceOverChunksInput(
    value: unknown,
  ): NormalizedVoiceOverChunk[] | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (!Array.isArray(value)) return null;

    const normalized = value
      .map((item, index) => {
        const url = String(item?.url ?? '').trim();
        const text = String(item?.text ?? '').trim();
        if (!url || !text) return null;

        const rawIndex = this.normalizeOptionalNumber(item?.index);
        const sentences = Array.isArray(item?.sentences)
          ? item.sentences
              .map((sentence: unknown) => String(sentence ?? '').trim())
              .filter(Boolean)
          : [];

        return {
          index:
            rawIndex !== null && rawIndex >= 0 ? Math.floor(rawIndex) : index,
          text,
          sentences,
          provider: String(item?.provider ?? '').trim() || null,
          providerVoiceId: String(item?.providerVoiceId ?? '').trim() || null,
          providerVoiceName:
            String(item?.providerVoiceName ?? '').trim() || null,
          mimeType: String(item?.mimeType ?? '').trim() || null,
          styleInstructions:
            String(item?.styleInstructions ?? '').trim() || null,
          durationSeconds: this.normalizeOptionalNumber(item?.durationSeconds),
          estimatedSeconds: this.normalizeOptionalNumber(
            item?.estimatedSeconds,
          ),
          url,
          fileName: String(item?.fileName ?? '').trim() || null,
          createdAt: String(item?.createdAt ?? '').trim() || null,
          elevenLabsSettings:
            this.normalizeElevenLabsVoiceSettingsInput(
              item?.elevenLabsSettings,
            ) ?? null,
        } satisfies NormalizedVoiceOverChunk;
      })
      .filter(Boolean) as NormalizedVoiceOverChunk[];

    return normalized.sort((left, right) => left.index - right.index);
  }

  private normalizeVoiceGenerationConfigInput(
    value: unknown,
  ): NormalizedVoiceGenerationConfig | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const mode = (value as any).mode === 'perSentence' ? 'perSentence' : 'auto';
    const providerRaw = String((value as any).provider ?? '').trim();
    const provider =
      providerRaw === 'google' || providerRaw === 'elevenlabs'
        ? providerRaw
        : null;

    return {
      mode,
      provider,
      providerVoiceId:
        String((value as any).providerVoiceId ?? '').trim() || null,
      styleInstructions:
        String((value as any).styleInstructions ?? '').trim() || null,
      elevenLabsSettings:
        this.normalizeElevenLabsVoiceSettingsInput(
          (value as any).elevenLabsSettings,
        ) ?? null,
    };
  }

  private normalizeElevenLabsVoiceSettingsInput(
    value: unknown,
  ): NormalizedElevenLabsVoiceSettings | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const normalizeOptional = (
      raw: unknown,
      min: number,
      max: number,
    ): number | null => {
      const numeric = this.normalizeOptionalNumber(raw);
      if (numeric === null) return null;
      return Math.min(max, Math.max(min, numeric));
    };

    const useSpeakerBoostRaw = (value as any).useSpeakerBoost;

    return {
      stability: normalizeOptional((value as any).stability, 0, 1),
      similarityBoost: normalizeOptional((value as any).similarityBoost, 0, 1),
      style: normalizeOptional((value as any).style, 0, 1),
      speed: normalizeOptional((value as any).speed, 0.5, 1.5),
      useSpeakerBoost:
        typeof useSpeakerBoostRaw === 'boolean' ? useSpeakerBoostRaw : null,
    };
  }

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Script)
    private readonly scriptRepository: Repository<Script>,
    @InjectRepository(Sentence)
    private readonly sentenceRepository: Repository<Sentence>,
    @InjectRepository(SentenceSoundEffect)
    private readonly sentenceSoundEffectRepository: Repository<SentenceSoundEffect>,
    @InjectRepository(Image)
    private readonly imageRepository: Repository<Image>,
    @InjectRepository(VideoEntity)
    private readonly videoRepository: Repository<VideoEntity>,
    @InjectRepository(SoundEffect)
    private readonly soundEffectRepository: Repository<SoundEffect>,
    @InjectRepository(ScriptTranslationGroup)
    private readonly scriptTranslationGroupRepository: Repository<ScriptTranslationGroup>,
    private readonly aiService: AiService,
  ) {}

  private normalizeSentenceSoundEffectTimingMode(
    value: unknown,
  ): SentenceSoundEffectTimingMode {
    return value === 'after_previous_ends'
      ? 'after_previous_ends'
      : 'with_previous';
  }

  private async saveSentenceSoundEffectsForSentenceInputs(params: {
    userId: string;
    sentenceInputs: Array<any>;
    savedSentences: Sentence[];
  }): Promise<void> {
    const userId = params.userId;
    const sentenceInputs = Array.isArray(params.sentenceInputs)
      ? params.sentenceInputs
      : [];
    const savedSentences = Array.isArray(params.savedSentences)
      ? params.savedSentences
      : [];

    if (sentenceInputs.length === 0 || savedSentences.length === 0) return;

    const sentenceByIndex = new Map<number, Sentence>();
    for (const s of savedSentences) {
      if (typeof (s as any).index === 'number') {
        sentenceByIndex.set((s as any).index as number, s);
      }
    }

    const allIds: string[] = [];
    for (const sentenceInput of sentenceInputs) {
      const items = Array.isArray(sentenceInput?.sound_effects)
        ? sentenceInput.sound_effects
        : [];
      for (const item of items) {
        const id = String(item?.sound_effect_id ?? '').trim();
        if (id) allIds.push(id);
      }
    }

    const uniqueIds = Array.from(new Set(allIds));
    if (uniqueIds.length === 0) return;

    const owned = await this.soundEffectRepository.find({
      where: { id: In(uniqueIds), user_id: userId },
      select: { id: true },
    });
    const ownedSet = new Set(owned.map((s) => s.id));

    const joinRows: SentenceSoundEffect[] = [];
    for (
      let sentenceIndex = 0;
      sentenceIndex < sentenceInputs.length;
      sentenceIndex++
    ) {
      const sentenceInput = sentenceInputs[sentenceIndex];
      const sentenceEntity = sentenceByIndex.get(sentenceIndex);
      if (!sentenceEntity) continue;

      const items = Array.isArray(sentenceInput?.sound_effects)
        ? sentenceInput.sound_effects
        : [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const soundEffectId = String(item?.sound_effect_id ?? '').trim();
        if (!soundEffectId || !ownedSet.has(soundEffectId)) continue;

        const delaySecondsRaw = Number(item?.delay_seconds ?? 0);
        const delaySeconds = Number.isFinite(delaySecondsRaw)
          ? Math.max(0, delaySecondsRaw)
          : 0;

        const volumeRaw = item?.volume_percent;
        const volumePercent =
          volumeRaw === null || volumeRaw === undefined
            ? null
            : (() => {
                const v = Number(volumeRaw);
                if (!Number.isFinite(v)) return null;
                return Math.max(0, Math.min(300, Math.round(v)));
              })();
        const timingMode = this.normalizeSentenceSoundEffectTimingMode(
          item?.timing_mode,
        );
        const audioSettingsOverride =
          item?.audio_settings_override &&
          typeof item.audio_settings_override === 'object'
            ? normalizeSoundEffectAudioSettings(item.audio_settings_override)
            : null;

        joinRows.push(
          this.sentenceSoundEffectRepository.create({
            sentence_id: sentenceEntity.id,
            sound_effect_id: soundEffectId,
            index: i,
            delay_seconds: delaySeconds,
            volume_percent: volumePercent,
            timing_mode: timingMode,
            audio_settings_override: audioSettingsOverride,
          }),
        );
      }
    }

    if (joinRows.length > 0) {
      await this.sentenceSoundEffectRepository.save(joinRows);
    }
  }

  private normalizeDetachedSoundEffectsInput(
    value: unknown,
  ): Array<Record<string, unknown>> | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;

    let nextValue = value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;

      try {
        nextValue = JSON.parse(trimmed);
      } catch {
        return null;
      }
    }

    if (!Array.isArray(nextValue)) {
      return null;
    }

    return nextValue.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item),
    );
  }

  private normalizeStoredDetachedSoundEffects(
    value: unknown,
  ): Array<Record<string, unknown>> | null {
    const items = this.normalizeDetachedSoundEffectsInput(value);
    if (!items || items.length === 0) return null;

    const normalized = items
      .map((item) => {
        const soundEffectId = String(item.sound_effect_id ?? '').trim();
        if (!soundEffectId) return null;

        const delaySecondsRaw = Number(item.delay_seconds ?? 0);
        const volumePercentRaw = Number(item.volume_percent ?? 100);
        const durationSecondsRaw = this.normalizeOptionalNumber(
          item.duration_seconds,
        );

        return {
          sound_effect_id: soundEffectId,
          title: String(item.title ?? '').trim() || 'Sound effect',
          url: String(item.url ?? '').trim() || null,
          delay_seconds: Number.isFinite(delaySecondsRaw)
            ? Math.max(0, delaySecondsRaw)
            : 0,
          volume_percent: Number.isFinite(volumePercentRaw)
            ? Math.max(0, Math.min(300, volumePercentRaw))
            : 100,
          timing_mode: this.normalizeSentenceSoundEffectTimingMode(
            item.timing_mode,
          ),
          audio_settings_override:
            item.audio_settings_override &&
            typeof item.audio_settings_override === 'object' &&
            !Array.isArray(item.audio_settings_override)
              ? normalizeSoundEffectAudioSettings(item.audio_settings_override)
              : null,
          default_audio_settings:
            item.default_audio_settings &&
            typeof item.default_audio_settings === 'object' &&
            !Array.isArray(item.default_audio_settings)
              ? normalizeSoundEffectAudioSettings(item.default_audio_settings)
              : null,
          duration_seconds:
            durationSecondsRaw === null
              ? null
              : Math.max(0, durationSecondsRaw),
        };
      })
      .filter(Boolean) as Array<Record<string, unknown>>;

    return normalized.length > 0 ? normalized : null;
  }

  private async normalizeDetachedSoundEffectsForUser(params: {
    userId: string;
    value: unknown;
  }): Promise<Array<Record<string, unknown>> | null | undefined> {
    const items = this.normalizeDetachedSoundEffectsInput(params.value);
    if (items === undefined) return undefined;
    if (!items || items.length === 0) return null;

    const ids = items
      .map((item) => String(item.sound_effect_id ?? '').trim())
      .filter(Boolean);
    if (ids.length === 0) return null;

    const owned = await this.soundEffectRepository.find({
      where: {
        id: In(Array.from(new Set(ids))),
        user_id: params.userId,
      },
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

      const delaySecondsRaw = Number(item.delay_seconds ?? 0);
      const requestedVolumePercent = this.normalizeOptionalNumber(
        item.volume_percent,
      );
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
          url: String(soundEffect.url ?? '').trim() || null,
          delay_seconds: Number.isFinite(delaySecondsRaw)
            ? Math.max(0, delaySecondsRaw)
            : 0,
          volume_percent:
            requestedVolumePercent === null
              ? Math.max(
                  0,
                  Math.min(
                    300,
                    Number(soundEffect.volume_percent ?? 100) || 100,
                  ),
                )
              : Math.max(0, Math.min(300, requestedVolumePercent)),
          timing_mode: this.normalizeSentenceSoundEffectTimingMode(
            item.timing_mode,
          ),
          audio_settings_override:
            item.audio_settings_override &&
            typeof item.audio_settings_override === 'object' &&
            !Array.isArray(item.audio_settings_override)
              ? normalizeSoundEffectAudioSettings(item.audio_settings_override)
              : null,
          default_audio_settings: defaultAudioSettings,
          duration_seconds:
            typeof soundEffect.duration_seconds === 'number' &&
            Number.isFinite(soundEffect.duration_seconds)
              ? Math.max(0, soundEffect.duration_seconds)
              : null,
        },
      ];
    });

    return normalized.length > 0 ? normalized : null;
  }

  private async normalizeDetachedSoundEffectsForSentenceInputs(params: {
    userId: string;
    sentenceInputs: Array<any>;
  }): Promise<Array<any>> {
    const sentenceInputs = Array.isArray(params.sentenceInputs)
      ? params.sentenceInputs
      : [];

    return Promise.all(
      sentenceInputs.map(async (sentenceInput) => {
        const nextSentenceInput =
          sentenceInput && typeof sentenceInput === 'object'
            ? { ...sentenceInput }
            : {};

        nextSentenceInput.text_animation_sound_effects =
          (await this.normalizeDetachedSoundEffectsForUser({
            userId: params.userId,
            value: sentenceInput?.text_animation_sound_effects,
          })) ?? null;
        nextSentenceInput.overlay_sound_effects =
          (await this.normalizeDetachedSoundEffectsForUser({
            userId: params.userId,
            value: sentenceInput?.overlay_sound_effects,
          })) ?? null;

        return nextSentenceInput;
      }),
    );
  }

  private normalizeTransitionSoundEffectsInput(items: any): Array<{
    sound_effect_id: string;
    title?: string;
    url?: string;
    delay_seconds: number;
    volume_percent: number;
  }> | null {
    const list = Array.isArray(items) ? items : [];
    const normalized = list
      .map((item) => {
        const sound_effect_id = String(item?.sound_effect_id ?? '').trim();
        if (!sound_effect_id) return null;

        const title = String(item?.title ?? '').trim() || undefined;
        const url = String(item?.url ?? '').trim() || undefined;
        const delayRaw = Number(item?.delay_seconds ?? 0);
        const volumeRaw = Number(item?.volume_percent ?? 100);

        return {
          sound_effect_id,
          ...(title ? { title } : {}),
          ...(url ? { url } : {}),
          delay_seconds: Number.isFinite(delayRaw) ? Math.max(0, delayRaw) : 0,
          volume_percent: Number.isFinite(volumeRaw)
            ? Math.max(0, Math.min(300, volumeRaw))
            : 100,
        };
      })
      .filter(Boolean) as Array<{
      sound_effect_id: string;
      title?: string;
      url?: string;
      delay_seconds: number;
      volume_percent: number;
    }>;

    return normalized.length > 0 ? normalized : null;
  }

  async onModuleInit() {
    // Best-effort on boot. We also call this lazily in request paths because
    // in some setups the `scripts` table may not exist yet during module init.
    await this.ensureScriptsSchemaLazy();
  }

  private async scriptsTableExists(): Promise<boolean> {
    try {
      const rows = await this.dataSource.query(
        "SELECT to_regclass('scripts') as reg",
      );
      return Boolean(rows?.[0]?.reg);
    } catch {
      return false;
    }
  }

  private async scriptsColumnExists(columnName: string): Promise<boolean> {
    const name = String(columnName ?? '').trim();
    if (!name) return false;

    try {
      const rows = await this.dataSource.query(
        `
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'scripts'
            AND column_name = $1
          LIMIT 1
        `,
        [name],
      );
      return rows.length > 0;
    } catch {
      return false;
    }
  }

  private async sentencesTableExists(): Promise<boolean> {
    try {
      const rows = await this.dataSource.query(
        "SELECT to_regclass('sentences') as reg",
      );
      return Boolean(rows?.[0]?.reg);
    } catch {
      return false;
    }
  }

  private async sentencesColumnExists(columnName: string): Promise<boolean> {
    const name = String(columnName ?? '').trim();
    if (!name) return false;

    try {
      const rows = await this.dataSource.query(
        `
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'sentences'
            AND column_name = $1
          LIMIT 1
        `,
        [name],
      );
      return rows.length > 0;
    } catch {
      return false;
    }
  }

  private async sentenceSoundEffectsTableExists(): Promise<boolean> {
    try {
      const rows = await this.dataSource.query(
        "SELECT to_regclass('sentence_sound_effects') as reg",
      );
      return Boolean(rows?.[0]?.reg);
    } catch {
      return false;
    }
  }

  private async sentenceSoundEffectsColumnExists(
    columnName: string,
  ): Promise<boolean> {
    const name = String(columnName ?? '').trim();
    if (!name) return false;

    try {
      const rows = await this.dataSource.query(
        `
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'sentence_sound_effects'
            AND column_name = $1
          LIMIT 1
        `,
        [name],
      );
      return rows.length > 0;
    } catch {
      return false;
    }
  }

  private async ensureScriptsSchemaLazy(): Promise<void> {
    if (this.scriptsSchemaEnsured) return;

    this.scriptsSchemaEnsuring = (async () => {
      const tableExists = await this.scriptsTableExists();
      if (!tableExists) return;

      const hasIsShortScript = await this.scriptsColumnExists('isShortScript');
      const hasShortsScripts = await this.scriptsColumnExists('shorts_scripts');
      const hasYoutubeUrl = await this.scriptsColumnExists('youtube_url');
      const hasFacebookUrl = await this.scriptsColumnExists('facebook_url');
      const hasInstagramUrl = await this.scriptsColumnExists('instagram_url');
      const hasTiktokUrl = await this.scriptsColumnExists('tiktok_url');
      const hasLocations = await this.scriptsColumnExists('locations');
      const hasLanguage = await this.scriptsColumnExists('language');
      const hasVoiceOverChunks =
        await this.scriptsColumnExists('voice_over_chunks');

      const sentencesTableExists = await this.sentencesTableExists();
      const hasSentenceCharacterKeys = sentencesTableExists
        ? await this.sentencesColumnExists('character_keys')
        : true;
      const hasSentenceLocationKey = sentencesTableExists
        ? await this.sentencesColumnExists('location_key')
        : true;
      const hasSentenceForcedLocationKey = sentencesTableExists
        ? await this.sentencesColumnExists('forced_location_key')
        : true;
      const hasSentenceVideoPrompt = sentencesTableExists
        ? await this.sentencesColumnExists('video_prompt')
        : true;
      const hasSentenceAlignSoundEffectsToSceneEnd = sentencesTableExists
        ? await this.sentencesColumnExists('align_sound_effects_to_scene_end')
        : true;
      const sentenceSoundEffectsTableExists =
        await this.sentenceSoundEffectsTableExists();
      const hasSentenceSoundEffectTimingMode = sentenceSoundEffectsTableExists
        ? await this.sentenceSoundEffectsColumnExists('timing_mode')
        : true;
      const hasSentenceSoundEffectAudioSettingsOverride =
        sentenceSoundEffectsTableExists
          ? await this.sentenceSoundEffectsColumnExists(
              'audio_settings_override',
            )
          : true;

      if (
        !hasIsShortScript ||
        !hasShortsScripts ||
        !hasYoutubeUrl ||
        !hasFacebookUrl ||
        !hasInstagramUrl ||
        !hasTiktokUrl ||
        !hasLocations ||
        !hasLanguage ||
        !hasVoiceOverChunks ||
        !hasSentenceCharacterKeys ||
        !hasSentenceLocationKey ||
        !hasSentenceForcedLocationKey ||
        !hasSentenceVideoPrompt ||
        !hasSentenceAlignSoundEffectsToSceneEnd ||
        !hasSentenceSoundEffectTimingMode ||
        !hasSentenceSoundEffectAudioSettingsOverride
      ) {
        await this.ensureScriptsSchema();
      }

      const finalHasIsShortScript =
        await this.scriptsColumnExists('isShortScript');
      const finalHasShortsScripts =
        await this.scriptsColumnExists('shorts_scripts');
      const finalHasYoutubeUrl = await this.scriptsColumnExists('youtube_url');
      const finalHasFacebookUrl =
        await this.scriptsColumnExists('facebook_url');
      const finalHasInstagramUrl =
        await this.scriptsColumnExists('instagram_url');
      const finalHasTiktokUrl = await this.scriptsColumnExists('tiktok_url');
      const finalHasLocations = await this.scriptsColumnExists('locations');
      const finalHasLanguage = await this.scriptsColumnExists('language');
      const finalHasVoiceOverChunks =
        await this.scriptsColumnExists('voice_over_chunks');

      const finalSentencesTableExists = await this.sentencesTableExists();
      const finalHasSentenceCharacterKeys = finalSentencesTableExists
        ? await this.sentencesColumnExists('character_keys')
        : true;
      const finalHasSentenceLocationKey = finalSentencesTableExists
        ? await this.sentencesColumnExists('location_key')
        : true;
      const finalHasSentenceForcedLocationKey = finalSentencesTableExists
        ? await this.sentencesColumnExists('forced_location_key')
        : true;
      const finalHasSentenceVideoPrompt = finalSentencesTableExists
        ? await this.sentencesColumnExists('video_prompt')
        : true;
      const finalHasSentenceAlignSoundEffectsToSceneEnd =
        finalSentencesTableExists
          ? await this.sentencesColumnExists('align_sound_effects_to_scene_end')
          : true;
      const finalSentenceSoundEffectsTableExists =
        await this.sentenceSoundEffectsTableExists();
      const finalHasSentenceSoundEffectTimingMode =
        finalSentenceSoundEffectsTableExists
          ? await this.sentenceSoundEffectsColumnExists('timing_mode')
          : true;
      const finalHasSentenceSoundEffectAudioSettingsOverride =
        finalSentenceSoundEffectsTableExists
          ? await this.sentenceSoundEffectsColumnExists(
              'audio_settings_override',
            )
          : true;

      if (
        !finalHasIsShortScript ||
        !finalHasShortsScripts ||
        !finalHasYoutubeUrl ||
        !finalHasFacebookUrl ||
        !finalHasInstagramUrl ||
        !finalHasTiktokUrl ||
        !finalHasLocations ||
        !finalHasLanguage ||
        !finalHasVoiceOverChunks ||
        !finalHasSentenceCharacterKeys ||
        !finalHasSentenceLocationKey ||
        !finalHasSentenceForcedLocationKey ||
        !finalHasSentenceVideoPrompt ||
        !finalHasSentenceAlignSoundEffectsToSceneEnd ||
        !finalHasSentenceSoundEffectTimingMode ||
        !finalHasSentenceSoundEffectAudioSettingsOverride
      ) {
        throw new InternalServerErrorException(
          'Database schema is missing required columns on `scripts`/`sentences` (expected: "isShortScript", shorts_scripts, youtube_url, facebook_url, instagram_url, tiktok_url, locations, language, and sentences.character_keys/location_key/forced_location_key). ' +
            'This also includes scripts.voice_over_chunks. ' +
            'Ensure your DB user has ALTER permissions, or apply the schema update SQL in `ScriptsService.ensureScriptsSchema()`.',
        );
      }

      this.scriptsSchemaEnsured = true;
    })().finally(() => {
      this.scriptsSchemaEnsuring = null;
    });

    return this.scriptsSchemaEnsuring;
  }

  private async ensureScriptsSchema() {
    // Older DBs may have the scripts table without newer columns.
    // This guard avoids runtime errors like:
    // QueryFailedError: column script.isShortScript does not exist
    const tableExists = await this.scriptsTableExists();
    if (!tableExists) return;

    try {
      await this.dataSource.query(
        'ALTER TABLE scripts ADD COLUMN IF NOT EXISTS "isShortScript" BOOLEAN NOT NULL DEFAULT false',
      );
    } catch (err: any) {
      const message = String(err?.message || '');
      if (
        message.includes('does not exist') ||
        message.includes('permission denied')
      ) {
        return;
      }
      throw err;
    }

    // shorts_scripts is stored on the parent script as an ordered list of short IDs.
    try {
      await this.dataSource.query(
        'ALTER TABLE scripts ADD COLUMN IF NOT EXISTS shorts_scripts JSONB NULL',
      );
    } catch (err: any) {
      const message = String(err?.message || '');
      if (
        message.includes('does not exist') ||
        message.includes('permission denied')
      ) {
        return;
      }
      throw err;
    }

    // Optional YouTube URL for the uploaded video.
    try {
      await this.dataSource.query(
        'ALTER TABLE scripts ADD COLUMN IF NOT EXISTS youtube_url VARCHAR(2048) NULL',
      );
    } catch (err: any) {
      const message = String(err?.message || '');
      if (
        message.includes('does not exist') ||
        message.includes('permission denied')
      ) {
        return;
      }
      throw err;
    }

    try {
      await this.dataSource.query(
        'ALTER TABLE scripts ADD COLUMN IF NOT EXISTS facebook_url VARCHAR(2048) NULL',
      );
    } catch (err: any) {
      const message = String(err?.message || '');
      if (
        message.includes('does not exist') ||
        message.includes('permission denied')
      ) {
        return;
      }
      throw err;
    }

    try {
      await this.dataSource.query(
        'ALTER TABLE scripts ADD COLUMN IF NOT EXISTS instagram_url VARCHAR(2048) NULL',
      );
    } catch (err: any) {
      const message = String(err?.message || '');
      if (
        message.includes('does not exist') ||
        message.includes('permission denied')
      ) {
        return;
      }
      throw err;
    }

    try {
      await this.dataSource.query(
        'ALTER TABLE scripts ADD COLUMN IF NOT EXISTS tiktok_url VARCHAR(2048) NULL',
      );
    } catch (err: any) {
      const message = String(err?.message || '');
      if (
        message.includes('does not exist') ||
        message.includes('permission denied')
      ) {
        return;
      }
      throw err;
    }

    // Canonical locations extracted during splitting.
    try {
      await this.dataSource.query(
        'ALTER TABLE scripts ADD COLUMN IF NOT EXISTS locations JSONB NULL',
      );
    } catch (err: any) {
      const message = String(err?.message || '');
      if (
        message.includes('does not exist') ||
        message.includes('permission denied')
      ) {
        return;
      }
      throw err;
    }

    // Script language (ISO code), e.g. "en", "ar".
    try {
      await this.dataSource.query(
        "ALTER TABLE scripts ADD COLUMN IF NOT EXISTS language VARCHAR(20) NOT NULL DEFAULT 'en'",
      );
    } catch (err: any) {
      const message = String(err?.message || '');
      if (
        message.includes('does not exist') ||
        message.includes('permission denied')
      ) {
        return;
      }
      throw err;
    }

    try {
      await this.dataSource.query(
        'ALTER TABLE scripts ADD COLUMN IF NOT EXISTS voice_over_chunks JSONB NULL',
      );
    } catch (err: any) {
      const message = String(err?.message || '');
      if (
        message.includes('does not exist') ||
        message.includes('permission denied')
      ) {
        return;
      }
      throw err;
    }

    try {
      await this.dataSource.query(
        'ALTER TABLE scripts ADD COLUMN IF NOT EXISTS voice_generation_config JSONB NULL',
      );
    } catch (err: any) {
      const message = String(err?.message || '');
      if (
        message.includes('does not exist') ||
        message.includes('permission denied')
      ) {
        return;
      }
      throw err;
    }

    // Sentence-level location + non-forced character mapping.
    const sentencesExists = await this.sentencesTableExists();
    if (sentencesExists) {
      const tryAlterSentences = async (sql: string) => {
        try {
          await this.dataSource.query(sql);
        } catch (err: any) {
          const message = String(err?.message || '');
          if (
            message.includes('does not exist') ||
            message.includes('permission denied')
          ) {
            return;
          }
          throw err;
        }
      };

      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS character_keys JSONB NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS location_key TEXT NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS forced_location_key TEXT NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS secondary_image_id UUID NULL',
      );

      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS video_prompt TEXT NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS align_sound_effects_to_scene_end BOOLEAN NOT NULL DEFAULT FALSE',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS image_effects_mode TEXT NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS image_filter_id UUID NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS image_filter_settings JSONB NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS motion_effect_id UUID NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS image_motion_settings JSONB NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS scene_tab TEXT NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS text_animation_text TEXT NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS text_animation_effect TEXT NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS text_animation_id UUID NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS text_animation_settings JSONB NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS text_animation_sound_effects JSONB NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS text_background_image_id UUID NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS text_background_video_id UUID NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS overlay_id UUID NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS overlay_settings JSONB NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS overlay_sound_effects JSONB NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS voice_over_url VARCHAR(2048) NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS voice_over_mime_type VARCHAR(255) NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS voice_over_duration_seconds REAL NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS voice_over_provider TEXT NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS voice_over_voice_id TEXT NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS voice_over_voice_name TEXT NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS voice_over_style_instructions TEXT NULL',
      );
      await tryAlterSentences(
        'ALTER TABLE sentences ADD COLUMN IF NOT EXISTS eleven_labs_settings JSONB NULL',
      );
    }

    try {
      const hasLegacyEras = await this.scriptsColumnExists('eras');
      const hasLocations = await this.scriptsColumnExists('locations');
      if (hasLegacyEras && hasLocations) {
        await this.dataSource.query(
          'UPDATE scripts SET locations = eras WHERE locations IS NULL AND eras IS NOT NULL',
        );
      }
    } catch {
      // Best effort backfill only.
    }

    if (sentencesExists) {
      try {
        const hasLegacyEraKey = await this.sentencesColumnExists('era_key');
        const hasLocationKey = await this.sentencesColumnExists('location_key');
        if (hasLegacyEraKey && hasLocationKey) {
          await this.dataSource.query(
            'UPDATE sentences SET location_key = era_key WHERE location_key IS NULL AND era_key IS NOT NULL',
          );
        }

        const hasLegacyForcedEraKey =
          await this.sentencesColumnExists('forced_era_key');
        const hasForcedLocationKey = await this.sentencesColumnExists(
          'forced_location_key',
        );
        if (hasLegacyForcedEraKey && hasForcedLocationKey) {
          await this.dataSource.query(
            'UPDATE sentences SET forced_location_key = forced_era_key WHERE forced_location_key IS NULL AND forced_era_key IS NOT NULL',
          );
        }
      } catch {
        // Best effort backfill only.
      }
    }

    const sentenceSoundEffectsExists =
      await this.sentenceSoundEffectsTableExists();
    if (sentenceSoundEffectsExists) {
      try {
        await this.dataSource.query(
          "ALTER TABLE sentence_sound_effects ADD COLUMN IF NOT EXISTS timing_mode VARCHAR(32) NOT NULL DEFAULT 'with_previous'",
        );
        await this.dataSource.query(
          'ALTER TABLE sentence_sound_effects ADD COLUMN IF NOT EXISTS audio_settings_override JSONB NULL',
        );
      } catch (err: any) {
        const message = String(err?.message || '');
        if (
          message.includes('does not exist') ||
          message.includes('permission denied')
        ) {
          return;
        }
        throw err;
      }
    }

    // Best-effort indexes for performance. If the DB user lacks permissions,
    // ignore and continue (the app will still work, just slower).
    const tryIndex = async (sql: string) => {
      try {
        await this.dataSource.query(sql);
      } catch (err: any) {
        const message = String(err?.message || '');
        if (
          message.includes('does not exist') ||
          message.includes('permission denied')
        ) {
          return;
        }
        throw err;
      }
    };

    await tryIndex(
      'CREATE INDEX IF NOT EXISTS idx_scripts_user_created_at ON scripts (user_id, created_at DESC)',
    );
    await tryIndex(
      'CREATE INDEX IF NOT EXISTS idx_scripts_user_is_short_created_at ON scripts (user_id, "isShortScript", created_at DESC)',
    );
    await tryIndex(
      'CREATE INDEX IF NOT EXISTS idx_sentences_script_id ON sentences (script_id)',
    );
    await tryIndex(
      'CREATE INDEX IF NOT EXISTS idx_sentences_script_image_id ON sentences (script_id, image_id)',
    );
    await tryIndex(
      'CREATE INDEX IF NOT EXISTS idx_sentences_script_secondary_image_id ON sentences (script_id, secondary_image_id)',
    );
  }

  private async loadShortScriptsForParent(params: {
    userId: string;
    shortIds: string[];
  }): Promise<Script[]> {
    const { userId, shortIds } = params;
    const ids = Array.from(
      new Set(
        (shortIds ?? []).map((s) => String(s ?? '').trim()).filter(Boolean),
      ),
    );
    if (ids.length === 0) return [];

    const rows = await this.scriptRepository
      .createQueryBuilder('script')
      .leftJoinAndSelect('script.sentences', 'sentence')
      .leftJoinAndSelect('sentence.image', 'image')
      .leftJoinAndSelect(
        'sentence.textBackgroundImage',
        'text_background_image',
      )
      .leftJoinAndSelect(
        'sentence.textBackgroundVideo',
        'text_background_video',
      )
      .leftJoinAndSelect('sentence.secondaryImage', 'secondary_image')
      .leftJoinAndSelect('sentence.startFrameImage', 'start_frame_image')
      .leftJoinAndSelect('sentence.endFrameImage', 'end_frame_image')
      .leftJoinAndSelect('sentence.video', 'sentence_video')
      .leftJoinAndSelect('script.voice', 'voice')
      .addSelect('image.prompt')
      .addSelect('text_background_image.prompt')
      .addSelect('secondary_image.prompt')
      .addSelect('start_frame_image.prompt')
      .addSelect('end_frame_image.prompt')
      .where('script.user_id = :userId', { userId })
      .andWhere('script.id IN (:...ids)', { ids })
      .orderBy('sentence.index', 'ASC')
      .getMany();

    const byId = new Map(rows.map((r) => [r.id, r] as const));
    return (shortIds ?? [])
      .map((id) => byId.get(String(id ?? '').trim()))
      .filter(Boolean) as Script[];
  }

  private getPublicBaseUrl() {
    return (
      process.env.REMOTION_ASSET_BASE_URL ??
      `http://127.0.0.1:${process.env.PORT ?? 3000}`
    );
  }

  private getStorageRoot() {
    return join(process.cwd(), 'storage');
  }

  private ensureDir(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private toStaticUrl(relPath: string) {
    const normalized = relPath.split(sep).join('/');
    return `${this.getPublicBaseUrl()}/static/${normalized}`;
  }

  private inferVideoExt(params: { originalName?: string; mimeType?: string }) {
    const fromName = extname(String(params.originalName ?? '').trim());
    if (fromName) return fromName;
    const mt = String(params.mimeType ?? '').toLowerCase();
    if (mt.includes('webm')) return '.webm';
    if (mt.includes('quicktime')) return '.mov';
    return '.mp4';
  }

  private async downloadUrlToBuffer(params: {
    url: string;
    maxBytes: number;
    label: string;
  }): Promise<{ buffer: Buffer; mimeType: string }> {
    const urlString = String(params.url ?? '').trim();
    if (!urlString) {
      throw new BadRequestException(`Missing URL for ${params.label}`);
    }

    let res: Response;
    try {
      res = await fetch(urlString, { redirect: 'follow' } as any);
    } catch (e) {
      const details = e instanceof Error ? e.message : String(e);
      throw new InternalServerErrorException(
        `Failed to download ${params.label}. Details: ${details}`,
      );
    }

    if (!res.ok) {
      throw new InternalServerErrorException(
        `Failed to download ${params.label} (status ${res.status})`,
      );
    }

    const mimeType =
      res.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > params.maxBytes) {
      throw new BadRequestException(
        `${params.label} is too large (${arrayBuffer.byteLength} bytes)`,
      );
    }

    return { buffer: Buffer.from(arrayBuffer), mimeType };
  }

  private assertHttpUrl(raw: string, label: string): string {
    const s = String(raw ?? '').trim();
    if (!s) {
      throw new BadRequestException(`${label} is required`);
    }
    let parsed: URL;
    try {
      parsed = new URL(s);
    } catch {
      throw new BadRequestException(`${label} must be a valid absolute URL`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException(`${label} must use http or https`);
    }
    return s;
  }

  private normalizeShortsPayload(raw: any): Array<{
    script: string;
    title?: string | null;
    video_url?: string | null;
    sentences?: any[];
    characters?: any[];
  }> | null {
    if (raw === null) return [];
    if (raw === undefined) return null;
    if (!Array.isArray(raw)) return null;

    return raw
      .map((item) => ({
        script: String(item?.script ?? '').trim(),
        title:
          item?.title === undefined
            ? undefined
            : String(item?.title ?? '').trim() || null,
        video_url:
          item?.video_url === undefined
            ? undefined
            : String(item?.video_url ?? '').trim() || null,
        sentences: Array.isArray(item?.sentences) ? item.sentences : undefined,
        characters: Array.isArray(item?.characters)
          ? item.characters
          : undefined,
      }))
      .filter((v) => v.script);
  }

  private normalizeShortIdsPayload(raw: any): string[] | null {
    if (raw === undefined) return null;
    if (raw === null) return [];
    if (!Array.isArray(raw)) return null;

    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      const id = String(item ?? '').trim();
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  private async applyShortScriptIdsLinking(params: {
    userId: string;
    parent: Script;
    shortIds: string[];
  }): Promise<void> {
    const { userId, parent, shortIds } = params;

    const existingIds = Array.isArray((parent as any).shorts_scripts)
      ? ((parent as any).shorts_scripts as string[])
      : [];

    if (shortIds.length === 0) {
      if (existingIds.length > 0) {
        await this.deleteShortScriptsByIds(userId, existingIds);
      }
      await this.scriptRepository.update(
        { id: parent.id, user_id: userId } as any,
        { shorts_scripts: null } as any,
      );
      return;
    }

    const rows = await this.scriptRepository.find({
      where: { id: In(shortIds), user_id: userId },
      select: { id: true },
    });
    const owned = new Set(rows.map((r) => r.id));
    const missing = shortIds.filter((id) => !owned.has(id));
    if (missing.length > 0) {
      throw new BadRequestException('One or more short script IDs are invalid');
    }

    // Ensure linked scripts are marked as shorts so they are hidden from the library listing.
    await this.scriptRepository.update(
      { id: In(shortIds) as any, user_id: userId } as any,
      { isShortScript: true } as any,
    );

    // Delete any previously-linked shorts that are no longer referenced.
    const nextSet = new Set(shortIds);
    const toDelete = existingIds.filter((id) => id && !nextSet.has(id));
    if (toDelete.length > 0) {
      await this.deleteShortScriptsByIds(userId, toDelete);
    }

    await this.scriptRepository.update(
      { id: parent.id, user_id: userId } as any,
      { shorts_scripts: shortIds } as any,
    );
  }

  private async deleteShortScriptsByIds(userId: string, ids: string[]) {
    const uniqueIds = Array.from(new Set((ids ?? []).filter(Boolean)));
    if (uniqueIds.length === 0) return;

    // Ensure only user's scripts are touched.
    const rows = await this.scriptRepository.find({
      where: {
        id: In(uniqueIds),
        user_id: userId,
      },
      select: { id: true },
    });
    const ownedIds = rows.map((r) => r.id);
    if (ownedIds.length === 0) return;

    await this.sentenceRepository.delete({ script_id: In(ownedIds) as any });
    await this.scriptRepository.delete({
      id: In(ownedIds) as any,
      user_id: userId,
    } as any);
  }

  private async isScriptReferencedAsShort(params: {
    userId: string;
    scriptId: string;
  }): Promise<boolean> {
    const { userId, scriptId } = params;
    const id = String(scriptId ?? '').trim();
    if (!id) return false;

    const row = await this.scriptRepository
      .createQueryBuilder('parent')
      .select('parent.id', 'id')
      .where('parent.user_id = :userId', { userId })
      .andWhere('parent.shorts_scripts IS NOT NULL')
      .andWhere('parent.shorts_scripts ? :scriptId', { scriptId: id })
      .limit(1)
      .getRawOne<{ id: string }>();

    return Boolean(row?.id);
  }

  private async syncShortScripts(params: {
    userId: string;
    parent: Script;
    shorts: Array<{
      script: string;
      title?: string | null;
      video_url?: string | null;
      sentences?: any[];
      characters?: any[];
    }>;
  }): Promise<void> {
    const { userId, parent, shorts } = params;

    const existingIds = Array.isArray((parent as any).shorts_scripts)
      ? ((parent as any).shorts_scripts as string[])
      : [];

    const nextIds: string[] = [];

    for (let i = 0; i < shorts.length; i += 1) {
      const item = shorts[i];
      const existingId = existingIds[i];

      const baseTitle =
        item.title !== undefined
          ? item.title
          : parent.title
            ? `${parent.title} - Short ${i + 1}`
            : `Short ${i + 1}`;

      const cleanedVideoUrl =
        item.video_url === undefined ? undefined : (item.video_url ?? null);

      let shortScript: Script;

      if (existingId) {
        const found = await this.scriptRepository.findOne({
          where: { id: existingId, user_id: userId },
        });

        if (found) {
          found.isShortScript = true;
          found.script = item.script;
          found.title = baseTitle ?? null;
          found.voice_id = null;
          found.subject = parent.subject;
          found.subject_content = parent.subject_content;
          found.length = parent.length;
          found.style = parent.style;
          found.technique = parent.technique;
          found.characters =
            item.characters && item.characters.length > 0
              ? (item.characters as any)
              : parent.characters;
          (found as any).locations =
            (item as any).locations && (item as any).locations.length > 0
              ? (item as any).locations
              : (parent as any).locations;
          if (cleanedVideoUrl !== undefined) {
            found.video_url = cleanedVideoUrl;
          }

          shortScript = await this.scriptRepository.save(found);
        } else {
          shortScript = await this.scriptRepository.save(
            this.scriptRepository.create({
              user_id: userId,
              isShortScript: true,
              script: item.script,
              title: baseTitle ?? null,
              voice_id: null,
              video_url: cleanedVideoUrl ?? null,
              subject: parent.subject,
              subject_content: parent.subject_content,
              length: parent.length,
              style: parent.style,
              technique: parent.technique,
              characters:
                item.characters && item.characters.length > 0
                  ? (item.characters as any)
                  : parent.characters,
              locations:
                (item as any).locations && (item as any).locations.length > 0
                  ? (item as any).locations
                  : (parent as any).locations,
            }),
          );
        }
      } else {
        shortScript = await this.scriptRepository.save(
          this.scriptRepository.create({
            user_id: userId,
            isShortScript: true,
            script: item.script,
            title: baseTitle ?? null,
            voice_id: null,
            video_url: cleanedVideoUrl ?? null,
            subject: parent.subject,
            subject_content: parent.subject_content,
            length: parent.length,
            style: parent.style,
            technique: parent.technique,
            characters:
              item.characters && item.characters.length > 0
                ? (item.characters as any)
                : parent.characters,
            locations:
              (item as any).locations && (item as any).locations.length > 0
                ? (item as any).locations
                : (parent as any).locations,
          }),
        );
      }

      if (item.sentences !== undefined) {
        await this.sentenceRepository.delete({ script_id: shortScript.id });

        if (item.sentences.length > 0) {
          const normalizedSentenceInputs =
            await this.normalizeDetachedSoundEffectsForSentenceInputs({
              userId,
              sentenceInputs: item.sentences as any,
            });
          let suspenseAlreadyUsed = false;
          const sentenceEntities = normalizedSentenceInputs.map(
            (s: any, index: number) => {
              const wantsSuspense = Boolean(s.isSuspense);
              const isSuspense = wantsSuspense && !suspenseAlreadyUsed;
              if (isSuspense) suspenseAlreadyUsed = true;

              return this.sentenceRepository.create({
                text: String(s.text ?? ''),
                index,
                script_id: shortScript.id,
                align_sound_effects_to_scene_end: Boolean(
                  s.align_sound_effects_to_scene_end,
                ),
                image_id: s.image_id ?? null,
                secondary_image_id: s.secondary_image_id ?? null,
                start_frame_image_id: s.start_frame_image_id ?? null,
                end_frame_image_id: s.end_frame_image_id ?? null,
                video_id: s.video_id ?? null,
                text_background_image_id: s.text_background_image_id ?? null,
                text_background_video_id: s.text_background_video_id ?? null,
                overlay_id: this.normalizeOptionalId(s.overlay_id),
                voice_over_url: String(s.voice_over_url ?? '').trim() || null,
                voice_over_mime_type:
                  String(s.voice_over_mime_type ?? '').trim() || null,
                voice_over_duration_seconds: this.normalizeOptionalNumber(
                  s.voice_over_duration_seconds,
                ),
                voice_over_provider:
                  String(s.voice_over_provider ?? '').trim() || null,
                voice_over_voice_id:
                  String(s.voice_over_voice_id ?? '').trim() || null,
                voice_over_voice_name:
                  String(s.voice_over_voice_name ?? '').trim() || null,
                voice_over_style_instructions:
                  String(s.voice_over_style_instructions ?? '').trim() || null,
                eleven_labs_settings:
                  this.normalizeElevenLabsVoiceSettingsInput(
                    s.eleven_labs_settings,
                  ) ?? null,
                video_prompt: String(s.video_prompt ?? '').trim() || null,
                transition_to_next: s.transition_to_next ?? null,
                visual_effect: s.visual_effect ?? null,
                image_motion_effect: s.image_motion_effect ?? 'default',
                image_motion_speed: this.normalizeImageMotionSpeed(
                  s.image_motion_speed,
                ),
                image_effects_mode: this.normalizeImageEffectsMode(
                  s.image_effects_mode,
                ),
                scene_tab: this.normalizeSceneTab(s.scene_tab),
                image_filter_id: this.normalizeOptionalId(s.image_filter_id),
                image_filter_settings: this.normalizeSettingsObject(
                  s.image_filter_settings,
                ),
                motion_effect_id: this.normalizeOptionalId(s.motion_effect_id),
                image_motion_settings: this.normalizeSettingsObject(
                  s.image_motion_settings,
                ),
                text_animation_text: this.normalizeTextAnimationText(
                  s.text_animation_text,
                ),
                text_animation_effect: this.normalizeTextAnimationEffect(
                  s.text_animation_effect,
                ),
                text_animation_id: this.normalizeOptionalId(
                  s.text_animation_id,
                ),
                text_animation_settings:
                  this.normalizeTextAnimationSettingsObject(
                    s.text_animation_settings,
                  ),
                text_animation_sound_effects:
                  this.normalizeStoredDetachedSoundEffects(
                    s.text_animation_sound_effects,
                  ),
                overlay_settings: this.normalizeSettingsObject(
                  s.overlay_settings,
                ),
                overlay_sound_effects: this.normalizeStoredDetachedSoundEffects(
                  s.overlay_sound_effects,
                ),
                transition_sound_effects:
                  this.normalizeTransitionSoundEffectsInput(
                    s.transition_sound_effects,
                  ),
                isSuspense,
                forced_character_keys:
                  Array.isArray(s.forced_character_keys) &&
                  s.forced_character_keys.length > 0
                    ? s.forced_character_keys
                    : null,
                character_keys:
                  Array.isArray(s.character_keys) && s.character_keys.length > 0
                    ? s.character_keys
                    : null,
                location_key: String(s.location_key ?? '').trim() || null,
                forced_location_key:
                  String(s.forced_location_key ?? '').trim() || null,
              });
            },
          );

          const savedSentences =
            await this.sentenceRepository.save(sentenceEntities);
          await this.saveSentenceSoundEffectsForSentenceInputs({
            userId,
            sentenceInputs: normalizedSentenceInputs,
            savedSentences,
          });
        }
      }

      nextIds.push(shortScript.id);
    }

    // Delete any leftover old shorts beyond the new list.
    const toDelete = existingIds.slice(nextIds.length).filter(Boolean);
    if (toDelete.length > 0) {
      await this.deleteShortScriptsByIds(userId, toDelete);
    }

    // Avoid saving the full parent entity (which may have relations loaded) to prevent cascade side-effects.
    await this.scriptRepository.update(
      { id: parent.id, user_id: userId } as any,
      { shorts_scripts: nextIds.length > 0 ? nextIds : null } as any,
    );
  }

  async saveSentenceVideo(
    scriptId: string,
    sentenceId: string,
    userId: string,
    dto: SaveSentenceVideoDto,
    files?: { videoFile?: UploadedVideoFile },
  ): Promise<{ id: string; video: string }> {
    const target =
      dto?.target === 'textBackground' ? 'textBackground' : 'primary';

    const script = await this.scriptRepository.findOne({
      where: { id: scriptId, user_id: userId },
      select: { id: true },
    });

    if (!script) {
      throw new NotFoundException('Script not found');
    }

    const sentence = await this.sentenceRepository.findOne({
      where: { id: sentenceId, script_id: scriptId },
      select: { id: true, script_id: true },
    });

    if (!sentence) {
      throw new NotFoundException('Sentence not found');
    }

    const file = files?.videoFile;
    const hasUploadedFile = Boolean(file?.buffer && file.buffer.length > 0);

    let finalVideoUrl: string;

    if (hasUploadedFile) {
      const mimeType =
        String(file?.mimetype ?? '').trim() || 'application/octet-stream';
      if (!mimeType.startsWith('video/')) {
        throw new BadRequestException('Video file must be a video');
      }

      const cloudinaryConfigured =
        Boolean(process.env.CLOUDINARY_CLOUD_NAME) &&
        Boolean(process.env.CLOUDINARY_API_KEY) &&
        Boolean(process.env.CLOUDINARY_CLOUD_SECRET);

      if (cloudinaryConfigured) {
        try {
          const uploaded = await uploadBufferToCloudinary({
            buffer: file!.buffer,
            folder: 'auto-video-generator/sentence-videos',
            resource_type: 'video',
          });
          finalVideoUrl = uploaded.secure_url;
        } catch {
          // Fallback to local storage if upload fails.
          const ext = this.inferVideoExt({
            originalName: file?.originalname,
            mimeType,
          });
          const fileName = `${randomUUID()}${ext}`;
          const relPath = join('sentence-videos', fileName);
          const absDir = join(this.getStorageRoot(), 'sentence-videos');
          this.ensureDir(absDir);
          fs.writeFileSync(join(this.getStorageRoot(), relPath), file!.buffer);
          finalVideoUrl = this.toStaticUrl(relPath);
        }
      } else {
        const ext = this.inferVideoExt({
          originalName: file?.originalname,
          mimeType,
        });
        const fileName = `${randomUUID()}${ext}`;
        const relPath = join('sentence-videos', fileName);
        const absDir = join(this.getStorageRoot(), 'sentence-videos');
        this.ensureDir(absDir);
        fs.writeFileSync(join(this.getStorageRoot(), relPath), file!.buffer);
        finalVideoUrl = this.toStaticUrl(relPath);
      }
    } else {
      const rawUrl = String(dto?.videoUrl ?? '').trim();
      if (!rawUrl) {
        throw new BadRequestException('videoUrl is required');
      }

      // Allow local server URLs produced by our own generators.
      if (rawUrl.startsWith('/static/')) {
        finalVideoUrl = rawUrl;
      } else {
        finalVideoUrl = this.assertHttpUrl(rawUrl, 'videoUrl');
      }
    }

    // Column length is 255; keep a safety cap.
    if (finalVideoUrl.length > 255) {
      throw new BadRequestException('Video URL is too long');
    }

    const videoEntity = this.videoRepository.create({
      video: finalVideoUrl,
      user_id: userId,
      video_type: (dto?.video_type ?? 'gemini').trim() || 'gemini',
      video_size: dto?.video_size ?? VideoSize.PORTRAIT,
    });
    const saved = await this.videoRepository.save(videoEntity);

    const updatePayload =
      target === 'textBackground'
        ? { text_background_video_id: saved.id }
        : { video_id: saved.id };

    await this.sentenceRepository.update(
      { id: sentenceId, script_id: scriptId },
      updatePayload,
    );

    return { id: saved.id, video: saved.video };
  }

  async generateSentenceVideoFromFrames(
    scriptId: string,
    sentenceId: string,
    userId: string,
    dto: GenerateSentenceVideoDto,
    files?: {
      startFrameFile?: UploadedImageFile;
      endFrameFile?: UploadedImageFile;
    },
  ): Promise<Script> {
    const script = await this.scriptRepository.findOne({
      where: { id: scriptId, user_id: userId },
      select: { id: true },
    });

    if (!script) {
      throw new NotFoundException('Script not found');
    }

    const sentence = await this.sentenceRepository.findOne({
      where: { id: sentenceId, script_id: scriptId },
      relations: {
        startFrameImage: true,
        endFrameImage: true,
      },
    });

    if (!sentence) {
      throw new NotFoundException('Sentence not found');
    }

    const isLooping = Boolean(dto?.isLooping);

    const prompt = (dto?.prompt ?? sentence.text ?? '').trim();
    if (!prompt) {
      throw new BadRequestException('Prompt is required');
    }

    const fromUploadedImage = (
      file: UploadedImageFile | undefined,
      label: string,
    ): { buffer: Buffer; mimeType: string } | null => {
      if (!file) return null;
      const mimeType =
        String(file.mimetype ?? '').trim() || 'application/octet-stream';
      if (!mimeType.startsWith('image/')) {
        throw new BadRequestException(`${label} must be an image`);
      }
      const buffer = file.buffer;
      if (!buffer || !(buffer instanceof Buffer) || buffer.length === 0) {
        throw new BadRequestException(`${label} is missing file data`);
      }
      return { buffer, mimeType };
    };

    const startFromUpload = fromUploadedImage(
      files?.startFrameFile,
      'Start frame',
    );
    const endFromUpload = isLooping
      ? null
      : fromUploadedImage(files?.endFrameFile, 'End frame');

    const startUrl = sentence.startFrameImage?.image;
    const endUrl = sentence.endFrameImage?.image;

    if (!startFromUpload && !startUrl) {
      throw new BadRequestException('Start frame image is required');
    }
    if (!isLooping && !endFromUpload && !endUrl) {
      throw new BadRequestException('End frame image is required');
    }

    const start =
      startFromUpload ??
      (await this.downloadUrlToBuffer({
        url: startUrl!,
        maxBytes: 12 * 1024 * 1024,
        label: 'start frame image',
      }));

    const end = isLooping
      ? undefined
      : (endFromUpload ??
        (endUrl
          ? await this.downloadUrlToBuffer({
              url: endUrl,
              maxBytes: 12 * 1024 * 1024,
              label: 'end frame image',
            })
          : undefined));

    const generated = await this.aiService.generateVideoFromFrames({
      prompt,
      model: dto?.model,
      resolution: dto?.resolution,
      aspectRatio: dto?.aspectRatio,
      isLooping,
      startFrame: { buffer: start.buffer, mimeType: start.mimeType },
      endFrame: end
        ? { buffer: end.buffer, mimeType: end.mimeType }
        : undefined,
    });

    const cloudinaryConfigured =
      Boolean(process.env.CLOUDINARY_CLOUD_NAME) &&
      Boolean(process.env.CLOUDINARY_API_KEY) &&
      Boolean(process.env.CLOUDINARY_CLOUD_SECRET);

    let finalVideoUrl: string;
    if (cloudinaryConfigured) {
      try {
        const uploaded = await uploadBufferToCloudinary({
          buffer: generated.buffer,
          folder: 'auto-video-generator/sentence-videos',
          resource_type: 'video',
        });
        finalVideoUrl = uploaded.secure_url;
      } catch {
        const ext = this.inferVideoExt({ mimeType: generated.mimeType });
        const fileName = `${randomUUID()}${ext}`;
        const relPath = join('sentence-videos', fileName);
        const absDir = join(this.getStorageRoot(), 'sentence-videos');
        this.ensureDir(absDir);
        fs.writeFileSync(
          join(this.getStorageRoot(), relPath),
          generated.buffer,
        );
        finalVideoUrl = this.toStaticUrl(relPath);
      }
    } else {
      const ext = this.inferVideoExt({ mimeType: generated.mimeType });
      const fileName = `${randomUUID()}${ext}`;
      const relPath = join('sentence-videos', fileName);
      const absDir = join(this.getStorageRoot(), 'sentence-videos');
      this.ensureDir(absDir);
      fs.writeFileSync(join(this.getStorageRoot(), relPath), generated.buffer);
      finalVideoUrl = this.toStaticUrl(relPath);
    }

    const videoEntity = this.videoRepository.create({
      video: finalVideoUrl,
      user_id: userId,
      video_type: 'gemini',
      video_size: VideoSize.PORTRAIT,
    });
    const savedVideo = await this.videoRepository.save(videoEntity);

    sentence.video_id = savedVideo.id;
    await this.sentenceRepository.save(sentence);

    return this.findOne(scriptId, userId);
  }

  async updateSentenceMedia(
    scriptId: string,
    sentenceId: string,
    userId: string,
    dto: UpdateSentenceMediaDto,
  ): Promise<Script> {
    const script = await this.scriptRepository.findOne({
      where: { id: scriptId, user_id: userId },
      select: { id: true, user_id: true },
    });

    if (!script) {
      throw new NotFoundException('Script not found');
    }

    const sentence = await this.sentenceRepository.findOne({
      where: { id: sentenceId, script_id: scriptId },
    });

    if (!sentence) {
      throw new NotFoundException('Sentence not found');
    }

    const secondaryIdProvided = dto.secondary_image_id !== undefined;
    const startIdProvided = dto.start_frame_image_id !== undefined;
    const endIdProvided = dto.end_frame_image_id !== undefined;
    const videoIdProvided = dto.video_id !== undefined;

    if (secondaryIdProvided && dto.secondary_image_id) {
      const image = await this.imageRepository.findOne({
        where: { id: dto.secondary_image_id, user_id: userId },
        select: { id: true },
      });
      if (!image) {
        throw new NotFoundException('Secondary image not found');
      }
    }

    if (startIdProvided && dto.start_frame_image_id) {
      const image = await this.imageRepository.findOne({
        where: { id: dto.start_frame_image_id, user_id: userId },
        select: { id: true },
      });
      if (!image) {
        throw new NotFoundException('Start frame image not found');
      }
    }

    if (endIdProvided && dto.end_frame_image_id) {
      const image = await this.imageRepository.findOne({
        where: { id: dto.end_frame_image_id, user_id: userId },
        select: { id: true },
      });
      if (!image) {
        throw new NotFoundException('End frame image not found');
      }
    }

    if (videoIdProvided && dto.video_id) {
      const video = await this.videoRepository.findOne({
        where: { id: dto.video_id, user_id: userId },
        select: { id: true },
      });
      if (!video) {
        throw new NotFoundException('Sentence video not found');
      }
    }

    if (secondaryIdProvided) {
      sentence.secondary_image_id = dto.secondary_image_id ?? null;
    }
    if (startIdProvided) {
      sentence.start_frame_image_id = dto.start_frame_image_id ?? null;
    }
    if (endIdProvided) {
      sentence.end_frame_image_id = dto.end_frame_image_id ?? null;
    }
    if (videoIdProvided) {
      sentence.video_id = dto.video_id ?? null;
    }

    await this.sentenceRepository.save(sentence);
    return this.findOne(scriptId, userId);
  }

  async findByScriptText(
    userId: string,
    scriptText: string,
  ): Promise<Script | null> {
    await this.ensureScriptsSchemaLazy();
    const trimmed = (scriptText ?? '').trim();
    if (!trimmed) return null;

    return this.scriptRepository.findOne({
      where: {
        user_id: userId,
        script: trimmed,
      },
    });
  }

  async create(
    userId: string,
    createScriptDto: CreateScriptDto,
  ): Promise<Script> {
    await this.ensureScriptsSchemaLazy();
    const {
      script,
      language,
      subject,
      subject_content,
      length,
      style,
      technique,
      reference_script_ids,
      message_id,
      voice_id,
      video_url,
      youtube_url,
      facebook_url,
      instagram_url,
      tiktok_url,
      sentences,
      characters,
      locations,
      voice_over_chunks,
      voice_generation_config,
      title: providedTitle,
      shorts_scripts,
      shorts_script_ids,
      is_short_script,
    } = createScriptDto;
    const trimmedScript = script.trim();

    const cleanedSubject =
      subject === undefined ? undefined : (subject ?? '').trim() || null;

    const cleanedLanguage =
      language === undefined ? undefined : (language ?? '').trim() || 'en';
    const cleanedSubjectContent =
      subject_content === undefined
        ? undefined
        : (subject_content ?? '').trim() || null;
    const cleanedLength =
      length === undefined ? undefined : (length ?? '').trim() || null;
    const cleanedStyle =
      style === undefined ? undefined : (style ?? '').trim() || null;
    const cleanedTechnique =
      technique === undefined ? undefined : (technique ?? '').trim() || null;
    const normalizedVoiceOverChunks =
      this.normalizeVoiceOverChunksInput(voice_over_chunks);
    const normalizedVoiceGenerationConfig =
      this.normalizeVoiceGenerationConfigInput(voice_generation_config);

    const cleanedVideoUrl =
      video_url === undefined ? undefined : (video_url ?? '').trim() || null;

    const cleanedYoutubeUrl =
      youtube_url === undefined
        ? undefined
        : (youtube_url ?? '').trim() || null;

    const cleanedFacebookUrl =
      facebook_url === undefined
        ? undefined
        : (facebook_url ?? '').trim() || null;

    const cleanedInstagramUrl =
      instagram_url === undefined
        ? undefined
        : (instagram_url ?? '').trim() || null;

    const cleanedTiktokUrl =
      tiktok_url === undefined ? undefined : (tiktok_url ?? '').trim() || null;

    const cleanedReferenceIds =
      reference_script_ids === undefined
        ? undefined
        : Array.from(new Set((reference_script_ids ?? []).filter(Boolean)));

    const referenceScripts =
      cleanedReferenceIds === undefined
        ? undefined
        : cleanedReferenceIds.length > 0
          ? await this.scriptRepository.find({
              where: { id: In(cleanedReferenceIds), user_id: userId },
              select: { id: true, title: true, script: true, user_id: true },
            })
          : [];

    if (
      referenceScripts &&
      cleanedReferenceIds &&
      referenceScripts.length !== cleanedReferenceIds.length
    ) {
      // If any provided IDs don't belong to the user (or don't exist), ignore them rather than erroring.
      // This keeps drafts resilient if a referenced script was deleted.
    }

    // If an identical script already exists for this user, update it instead
    // of creating a new row, similar to how images are de-duplicated.
    const existingScript = await this.scriptRepository.findOne({
      where: {
        user_id: userId,
        script: trimmedScript,
      },
    });

    if (existingScript) {
      // Prefer an explicitly provided title; otherwise, keep the existing one.
      const newTitle = providedTitle?.trim() || existingScript.title;

      existingScript.title = newTitle ?? null;
      existingScript.message_id = message_id ?? existingScript.message_id;
      existingScript.voice_id = voice_id ?? existingScript.voice_id;

      if (cleanedVideoUrl !== undefined) {
        existingScript.video_url = cleanedVideoUrl;
      }

      if (cleanedYoutubeUrl !== undefined) {
        existingScript.youtube_url = cleanedYoutubeUrl;
      }

      if (cleanedFacebookUrl !== undefined) {
        existingScript.facebook_url = cleanedFacebookUrl;
      }

      if (cleanedInstagramUrl !== undefined) {
        existingScript.instagram_url = cleanedInstagramUrl;
      }

      if (cleanedTiktokUrl !== undefined) {
        existingScript.tiktok_url = cleanedTiktokUrl;
      }

      if (cleanedSubject !== undefined) existingScript.subject = cleanedSubject;
      if (cleanedSubjectContent !== undefined) {
        existingScript.subject_content = cleanedSubjectContent;
      }
      if (cleanedLength !== undefined) existingScript.length = cleanedLength;
      if (cleanedStyle !== undefined) existingScript.style = cleanedStyle;
      if (cleanedTechnique !== undefined)
        existingScript.technique = cleanedTechnique;

      if (cleanedLanguage !== undefined) {
        existingScript.language = cleanedLanguage;
      }

      if (normalizedVoiceOverChunks !== undefined) {
        (existingScript as any).voice_over_chunks =
          normalizedVoiceOverChunks && normalizedVoiceOverChunks.length > 0
            ? normalizedVoiceOverChunks
            : null;
      }

      if (normalizedVoiceGenerationConfig !== undefined) {
        (existingScript as any).voice_generation_config =
          normalizedVoiceGenerationConfig ?? null;
      }

      if (referenceScripts !== undefined) {
        existingScript.reference_scripts = referenceScripts;
      }

      if (characters !== undefined) {
        existingScript.characters =
          characters.length > 0 ? (characters as any) : null;
      }

      if (locations !== undefined) {
        (existingScript as any).locations =
          (locations as any).length > 0 ? (locations as any) : null;
      }

      if (is_short_script !== undefined) {
        existingScript.isShortScript = Boolean(is_short_script);
      }

      const updatedScript = await this.scriptRepository.save(existingScript);

      if (sentences && sentences.length > 0) {
        // Replace existing sentences with the new ones
        await this.sentenceRepository.delete({ script_id: updatedScript.id });

        const normalizedSentenceInputs =
          await this.normalizeDetachedSoundEffectsForSentenceInputs({
            userId,
            sentenceInputs: sentences as any,
          });
        let suspenseAlreadyUsed = false;
        const sentenceEntities = normalizedSentenceInputs.map((s, index) => {
          const wantsSuspense = Boolean(s.isSuspense);
          const isSuspense = wantsSuspense && !suspenseAlreadyUsed;
          if (isSuspense) suspenseAlreadyUsed = true;

          return this.sentenceRepository.create({
            text: s.text,
            index,
            script_id: updatedScript.id,
            align_sound_effects_to_scene_end: Boolean(
              s.align_sound_effects_to_scene_end,
            ),
            image_id: s.image_id ?? null,
            secondary_image_id: s.secondary_image_id ?? null,
            start_frame_image_id: s.start_frame_image_id ?? null,
            end_frame_image_id: s.end_frame_image_id ?? null,
            video_id: s.video_id ?? null,
            text_background_image_id: s.text_background_image_id ?? null,
            text_background_video_id: s.text_background_video_id ?? null,
            overlay_id: this.normalizeOptionalId(s.overlay_id),
            voice_over_url: String(s.voice_over_url ?? '').trim() || null,
            voice_over_mime_type:
              String(s.voice_over_mime_type ?? '').trim() || null,
            voice_over_duration_seconds: this.normalizeOptionalNumber(
              s.voice_over_duration_seconds,
            ),
            voice_over_provider:
              String(s.voice_over_provider ?? '').trim() || null,
            voice_over_voice_id:
              String(s.voice_over_voice_id ?? '').trim() || null,
            voice_over_voice_name:
              String(s.voice_over_voice_name ?? '').trim() || null,
            voice_over_style_instructions:
              String(s.voice_over_style_instructions ?? '').trim() || null,
            eleven_labs_settings:
              this.normalizeElevenLabsVoiceSettingsInput(
                s.eleven_labs_settings,
              ) ?? null,
            video_prompt: String(s.video_prompt ?? '').trim() || null,
            transition_to_next: s.transition_to_next ?? null,
            visual_effect: s.visual_effect ?? null,
            image_motion_effect: s.image_motion_effect ?? 'default',
            image_motion_speed: this.normalizeImageMotionSpeed(
              s.image_motion_speed,
            ),
            image_effects_mode: this.normalizeImageEffectsMode(
              s.image_effects_mode,
            ),
            scene_tab: this.normalizeSceneTab(s.scene_tab),
            image_filter_id: this.normalizeOptionalId(s.image_filter_id),
            image_filter_settings: this.normalizeSettingsObject(
              s.image_filter_settings,
            ),
            motion_effect_id: this.normalizeOptionalId(s.motion_effect_id),
            image_motion_settings: this.normalizeSettingsObject(
              s.image_motion_settings,
            ),
            text_animation_text: this.normalizeTextAnimationText(
              s.text_animation_text,
            ),
            text_animation_effect: this.normalizeTextAnimationEffect(
              s.text_animation_effect,
            ),
            text_animation_id: this.normalizeOptionalId(s.text_animation_id),
            text_animation_settings: this.normalizeTextAnimationSettingsObject(
              s.text_animation_settings,
            ),
            text_animation_sound_effects:
              this.normalizeStoredDetachedSoundEffects(
                s.text_animation_sound_effects,
              ),
            overlay_settings: this.normalizeSettingsObject(s.overlay_settings),
            overlay_sound_effects: this.normalizeStoredDetachedSoundEffects(
              s.overlay_sound_effects,
            ),
            transition_sound_effects: this.normalizeTransitionSoundEffectsInput(
              s.transition_sound_effects,
            ),
            isSuspense,
            forced_character_keys:
              Array.isArray(s.forced_character_keys) &&
              s.forced_character_keys.length > 0
                ? s.forced_character_keys
                : null,
            character_keys:
              Array.isArray(s.character_keys) && s.character_keys.length > 0
                ? s.character_keys
                : null,
            location_key: String(s.location_key ?? '').trim() || null,
            forced_location_key:
              String(s.forced_location_key ?? '').trim() || null,
          });
        });

        const savedSentences =
          await this.sentenceRepository.save(sentenceEntities);
        await this.saveSentenceSoundEffectsForSentenceInputs({
          userId,
          sentenceInputs: normalizedSentenceInputs,
          savedSentences,
        });
      }

      const normalizedShorts = this.normalizeShortsPayload(shorts_scripts);
      const normalizedShortIds =
        this.normalizeShortIdsPayload(shorts_script_ids);

      if (normalizedShortIds !== null) {
        await this.applyShortScriptIdsLinking({
          userId,
          parent: updatedScript,
          shortIds: normalizedShortIds,
        });
      } else if (normalizedShorts !== null) {
        if (normalizedShorts.length === 0) {
          const existingIds = Array.isArray(
            (updatedScript as any).shorts_scripts,
          )
            ? ((updatedScript as any).shorts_scripts as string[])
            : [];
          if (existingIds.length > 0) {
            await this.deleteShortScriptsByIds(userId, existingIds);
          }
          (updatedScript as any).shorts_scripts = null;
          await this.scriptRepository.save(updatedScript);
        } else {
          await this.syncShortScripts({
            userId,
            parent: updatedScript,
            shorts: normalizedShorts,
          });
        }
      }

      return this.findOne(updatedScript.id, userId);
    }

    const title =
      (providedTitle && providedTitle.trim()) ||
      (await this.aiService.generateTitleForScript(trimmedScript));

    const scriptEntity = this.scriptRepository.create({
      script: trimmedScript,
      user_id: userId,
      isShortScript: Boolean(is_short_script),
      message_id: message_id ?? null,
      voice_id: voice_id ?? null,
      video_url: cleanedVideoUrl ?? null,
      youtube_url: cleanedYoutubeUrl ?? null,
      facebook_url: cleanedFacebookUrl ?? null,
      instagram_url: cleanedInstagramUrl ?? null,
      tiktok_url: cleanedTiktokUrl ?? null,
      title: title || null,
      language: cleanedLanguage ?? 'en',
      subject: cleanedSubject ?? null,
      subject_content: cleanedSubjectContent ?? null,
      length: cleanedLength ?? null,
      style: cleanedStyle ?? null,
      technique: cleanedTechnique ?? null,
      characters:
        characters && characters.length > 0 ? (characters as any) : null,
      locations:
        locations && (locations as any).length > 0 ? (locations as any) : null,
      voice_generation_config: normalizedVoiceGenerationConfig ?? null,
      voice_over_chunks:
        normalizedVoiceOverChunks && normalizedVoiceOverChunks.length > 0
          ? normalizedVoiceOverChunks
          : null,
    });

    if (referenceScripts !== undefined) {
      scriptEntity.reference_scripts = referenceScripts;
    }

    const savedScript = await this.scriptRepository.save(scriptEntity);

    if (sentences && sentences.length > 0) {
      const normalizedSentenceInputs =
        await this.normalizeDetachedSoundEffectsForSentenceInputs({
          userId,
          sentenceInputs: sentences as any,
        });
      let suspenseAlreadyUsed = false;
      const sentenceEntities = normalizedSentenceInputs.map((s, index) => {
        const wantsSuspense = Boolean(s.isSuspense);
        const isSuspense = wantsSuspense && !suspenseAlreadyUsed;
        if (isSuspense) suspenseAlreadyUsed = true;

        return this.sentenceRepository.create({
          text: s.text,
          index,
          script_id: savedScript.id,
          align_sound_effects_to_scene_end: Boolean(
            s.align_sound_effects_to_scene_end,
          ),
          image_id: s.image_id ?? null,
          secondary_image_id: s.secondary_image_id ?? null,
          start_frame_image_id: s.start_frame_image_id ?? null,
          end_frame_image_id: s.end_frame_image_id ?? null,
          video_id: s.video_id ?? null,
          text_background_image_id: s.text_background_image_id ?? null,
          text_background_video_id: s.text_background_video_id ?? null,
          overlay_id: this.normalizeOptionalId(s.overlay_id),
          voice_over_url: String(s.voice_over_url ?? '').trim() || null,
          voice_over_mime_type:
            String(s.voice_over_mime_type ?? '').trim() || null,
          voice_over_duration_seconds: this.normalizeOptionalNumber(
            s.voice_over_duration_seconds,
          ),
          voice_over_provider:
            String(s.voice_over_provider ?? '').trim() || null,
          voice_over_voice_id:
            String(s.voice_over_voice_id ?? '').trim() || null,
          voice_over_voice_name:
            String(s.voice_over_voice_name ?? '').trim() || null,
          voice_over_style_instructions:
            String(s.voice_over_style_instructions ?? '').trim() || null,
          eleven_labs_settings:
            this.normalizeElevenLabsVoiceSettingsInput(
              s.eleven_labs_settings,
            ) ?? null,
          video_prompt: String(s.video_prompt ?? '').trim() || null,
          transition_to_next: s.transition_to_next ?? null,
          visual_effect: s.visual_effect ?? null,
          image_motion_effect: s.image_motion_effect ?? 'default',
          image_motion_speed: this.normalizeImageMotionSpeed(
            s.image_motion_speed,
          ),
          image_effects_mode: this.normalizeImageEffectsMode(
            s.image_effects_mode,
          ),
          scene_tab: this.normalizeSceneTab(s.scene_tab),
          image_filter_id: this.normalizeOptionalId(s.image_filter_id),
          image_filter_settings: this.normalizeSettingsObject(
            s.image_filter_settings,
          ),
          motion_effect_id: this.normalizeOptionalId(s.motion_effect_id),
          image_motion_settings: this.normalizeSettingsObject(
            s.image_motion_settings,
          ),
          text_animation_text: this.normalizeTextAnimationText(
            s.text_animation_text,
          ),
          text_animation_effect: this.normalizeTextAnimationEffect(
            s.text_animation_effect,
          ),
          text_animation_id: this.normalizeOptionalId(s.text_animation_id),
          text_animation_settings: this.normalizeTextAnimationSettingsObject(
            s.text_animation_settings,
          ),
          text_animation_sound_effects:
            this.normalizeStoredDetachedSoundEffects(
              s.text_animation_sound_effects,
            ),
          overlay_settings: this.normalizeSettingsObject(s.overlay_settings),
          overlay_sound_effects: this.normalizeStoredDetachedSoundEffects(
            s.overlay_sound_effects,
          ),
          transition_sound_effects: this.normalizeTransitionSoundEffectsInput(
            s.transition_sound_effects,
          ),
          isSuspense,
          forced_character_keys:
            Array.isArray(s.forced_character_keys) &&
            s.forced_character_keys.length > 0
              ? s.forced_character_keys
              : null,
          character_keys:
            Array.isArray(s.character_keys) && s.character_keys.length > 0
              ? s.character_keys
              : null,
          location_key: String(s.location_key ?? '').trim() || null,
          forced_location_key:
            String(s.forced_location_key ?? '').trim() || null,
        });
      });

      const savedSentences =
        await this.sentenceRepository.save(sentenceEntities);
      await this.saveSentenceSoundEffectsForSentenceInputs({
        userId,
        sentenceInputs: normalizedSentenceInputs,
        savedSentences,
      });
    }

    const normalizedShorts = this.normalizeShortsPayload(shorts_scripts);
    const normalizedShortIds = this.normalizeShortIdsPayload(shorts_script_ids);

    if (normalizedShortIds !== null) {
      await this.applyShortScriptIdsLinking({
        userId,
        parent: savedScript,
        shortIds: normalizedShortIds,
      });
    } else if (normalizedShorts !== null) {
      if (normalizedShorts.length === 0) {
        (savedScript as any).shorts_scripts = null;
        await this.scriptRepository.save(savedScript);
      } else {
        await this.syncShortScripts({
          userId,
          parent: savedScript,
          shorts: normalizedShorts,
        });
      }
    }

    return this.findOne(savedScript.id, userId);
  }

  async findAllByUser(
    userId: string,
    page = 1,
    limit = 10,
    q?: string,
  ): Promise<{
    items: Array<{
      id: string;
      title: string | null;
      language: string;
      script: string;
      created_at: Date;
      sentences_count: number;
      images_count: number;
    }>;
    total: number;
    page: number;
    limit: number;
  }> {
    await this.ensureScriptsSchemaLazy();
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit =
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 50) : 10;

    const query = typeof q === 'string' ? q.trim() : '';

    // Performance notes:
    // 1) Always filter by user_id.
    // 2) Avoid doing pagination (skip/take) against a query that joins 1:N tables
    //    (sentences), because it explodes row counts and can paginate incorrectly.
    // Instead, page script IDs first, then load relations only for those IDs.

    // Exclude any scripts that are linked as shorts in any parent.shorts_scripts.
    // Using a derived set (distinct short ids) avoids a correlated JSONB subquery per row.
    const baseQb = this.scriptRepository
      .createQueryBuilder('script')
      .leftJoin(
        (qb) =>
          qb
            .subQuery()
            .select(
              'DISTINCT jsonb_array_elements_text(parent.shorts_scripts)',
              'short_id',
            )
            .from(Script, 'parent')
            .where('parent.user_id = :userId', { userId })
            .andWhere('parent.shorts_scripts IS NOT NULL'),
        'short_ref',
        'short_ref.short_id = script.id::text',
      )
      .where('script.user_id = :userId', { userId })
      .andWhere(
        '(script.isShortScript IS NULL OR script.isShortScript = false)',
      )
      .andWhere('short_ref.short_id IS NULL');

    if (query) {
      baseQb.andWhere("COALESCE(script.title, '') ILIKE :q", {
        q: `%${query}%`,
      });
    }

    const [idRows, total] = await Promise.all([
      baseQb
        .clone()
        .select('script.id', 'id')
        .orderBy('script.created_at', 'DESC')
        .skip((safePage - 1) * safeLimit)
        .take(safeLimit)
        .getRawMany<{ id: string }>(),

      // Count without joining 1:N tables.
      baseQb.clone().getCount(),
    ]);

    const ids = idRows.map((r) => r.id).filter(Boolean);
    if (ids.length === 0) {
      return { items: [], total, page: safePage, limit: safeLimit };
    }

    // Fetch only the list fields we actually render in the library.
    // Sentences/images are expensive; we return counts instead.
    const orderCases: string[] = [];
    const orderParams: Record<string, any> = {};
    ids.forEach((id, idx) => {
      const key = `id_${idx}`;
      orderParams[key] = id;
      orderCases.push(`WHEN script.id = :${key} THEN ${idx}`);
    });

    const scriptsRaw = await this.scriptRepository
      .createQueryBuilder('script')
      .select('script.id', 'id')
      .addSelect('script.title', 'title')
      .addSelect('script.language', 'language')
      .addSelect('script.script', 'script')
      .addSelect('script.created_at', 'created_at')
      .where('script.user_id = :userId', { userId })
      .andWhere('script.id IN (:...ids)', { ids })
      .orderBy(`CASE ${orderCases.join(' ')} ELSE ${ids.length} END`)
      .setParameters(orderParams)
      .getRawMany<{
        id: string;
        title: string | null;
        language: string;
        script: string;
        created_at: Date;
      }>();

    const countsRaw = await this.sentenceRepository
      .createQueryBuilder('sentence')
      .select('sentence.script_id', 'script_id')
      .addSelect('COUNT(*)', 'sentences_count')
      .addSelect(
        'SUM(CASE WHEN sentence.image_id IS NOT NULL THEN 1 ELSE 0 END)',
        'images_count',
      )
      .where('sentence.script_id IN (:...ids)', { ids })
      .groupBy('sentence.script_id')
      .getRawMany<{
        script_id: string;
        sentences_count: string;
        images_count: string;
      }>();

    const countsByScriptId = new Map(
      countsRaw.map(
        (r) =>
          [
            r.script_id,
            {
              sentences_count: Number.parseInt(r.sentences_count, 10) || 0,
              images_count: Number.parseInt(r.images_count, 10) || 0,
            },
          ] as const,
      ),
    );

    const items = scriptsRaw.map((s) => {
      const counts = countsByScriptId.get(s.id) ?? {
        sentences_count: 0,
        images_count: 0,
      };

      return {
        ...s,
        sentences_count: counts.sentences_count,
        images_count: counts.images_count,
      };
    });

    return { items, total, page: safePage, limit: safeLimit };
  }

  async findOne(id: string, userId: string): Promise<Script> {
    await this.ensureScriptsSchemaLazy();
    const script = await this.scriptRepository
      .createQueryBuilder('script')
      .leftJoinAndSelect('script.sentences', 'sentence')
      .leftJoinAndSelect('sentence.sound_effects', 'sentence_sound_effect')
      .leftJoinAndSelect('sentence_sound_effect.sound_effect', 'sound_effect')
      .leftJoinAndSelect('sentence.image', 'image')
      .leftJoinAndSelect(
        'sentence.textBackgroundImage',
        'text_background_image',
      )
      .leftJoinAndSelect(
        'sentence.textBackgroundVideo',
        'text_background_video',
      )
      .leftJoinAndSelect('sentence.overlay', 'overlay')
      .leftJoinAndSelect('sentence.secondaryImage', 'secondary_image')
      .leftJoinAndSelect('sentence.startFrameImage', 'start_frame_image')
      .leftJoinAndSelect('sentence.endFrameImage', 'end_frame_image')
      .leftJoinAndSelect('sentence.video', 'sentence_video')
      .leftJoinAndSelect('script.voice', 'voice')
      .leftJoinAndSelect('script.reference_scripts', 'reference_script')
      .addSelect('image.prompt')
      .addSelect('text_background_image.prompt')
      .addSelect('secondary_image.prompt')
      .addSelect('start_frame_image.prompt')
      .addSelect('end_frame_image.prompt')
      .where('script.id = :id', { id })
      .andWhere('script.user_id = :userId', { userId })
      .orderBy('sentence.index', 'ASC')
      .addOrderBy('sentence_sound_effect.index', 'ASC')
      .getOne();

    if (!script) {
      throw new NotFoundException('Script not found');
    }

    const shortIds = Array.isArray((script as any).shorts_scripts)
      ? ((script as any).shorts_scripts as string[])
          .map((s) => String(s ?? '').trim())
          .filter(Boolean)
      : [];

    if (shortIds.length > 0) {
      const shortScripts = await this.loadShortScriptsForParent({
        userId,
        shortIds,
      });
      (script as any).short_scripts = shortScripts;
    }

    return script;
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateScriptDto,
  ): Promise<Script> {
    await this.ensureScriptsSchemaLazy();
    const script = await this.scriptRepository.findOne({
      where: { id, user_id: userId },
      relations: ['sentences'],
    });

    if (!script) {
      throw new NotFoundException('Script not found');
    }

    if (dto.script !== undefined) {
      const trimmedScript = (dto.script ?? '').trim();
      script.script = trimmedScript;
    }

    if (dto.subject !== undefined) {
      const trimmed = (dto.subject ?? '').trim();
      script.subject = trimmed ? trimmed : null;
    }

    if (dto.language !== undefined) {
      const trimmed = String(dto.language ?? '').trim();
      script.language = trimmed ? trimmed : 'en';
    }

    if (dto.subject_content !== undefined) {
      const trimmed = (dto.subject_content ?? '').trim();
      script.subject_content = trimmed ? trimmed : null;
    }

    if (dto.length !== undefined) {
      const trimmed = (dto.length ?? '').trim();
      script.length = trimmed ? trimmed : null;
    }

    if (dto.style !== undefined) {
      const trimmed = (dto.style ?? '').trim();
      script.style = trimmed ? trimmed : null;
    }

    if (dto.technique !== undefined) {
      const trimmed = (dto.technique ?? '').trim();
      script.technique = trimmed ? trimmed : null;
    }

    if (dto.reference_script_ids !== undefined) {
      const uniqueIds = Array.from(
        new Set((dto.reference_script_ids ?? []).filter(Boolean)),
      );
      if (uniqueIds.length === 0) {
        script.reference_scripts = [];
      } else {
        // Ignore missing/deleted scripts so updates don't fail if a reference was removed.
        const refs = await this.scriptRepository.find({
          where: { id: In(uniqueIds), user_id: userId },
          select: { id: true, title: true, script: true, user_id: true },
        });
        script.reference_scripts = refs;
      }
    }

    if (dto.characters !== undefined) {
      script.characters =
        dto.characters && dto.characters.length > 0
          ? (dto.characters as any)
          : null;
    }

    if ((dto as any).locations !== undefined) {
      (script as any).locations =
        (dto as any).locations && (dto as any).locations.length > 0
          ? (dto as any).locations
          : null;
    }

    if (Object.prototype.hasOwnProperty.call(dto, 'voice_over_chunks')) {
      const normalizedVoiceOverChunks = this.normalizeVoiceOverChunksInput(
        (dto as any).voice_over_chunks,
      );
      (script as any).voice_over_chunks =
        normalizedVoiceOverChunks && normalizedVoiceOverChunks.length > 0
          ? normalizedVoiceOverChunks
          : null;
    }

    if (Object.prototype.hasOwnProperty.call(dto, 'voice_generation_config')) {
      const normalizedVoiceGenerationConfig =
        this.normalizeVoiceGenerationConfigInput(
          (dto as any).voice_generation_config,
        );
      (script as any).voice_generation_config =
        normalizedVoiceGenerationConfig ?? null;
    }

    if (dto.title !== undefined) {
      const trimmedTitle = (dto.title ?? '').trim();
      script.title = trimmedTitle ? trimmedTitle : null;
    }

    if ((dto as any).is_short_script !== undefined) {
      const desired = Boolean((dto as any).is_short_script);

      if (!desired && script.isShortScript) {
        const isReferenced = await this.isScriptReferencedAsShort({
          userId,
          scriptId: script.id,
        });
        if (!isReferenced) {
          script.isShortScript = false;
        }
      } else {
        script.isShortScript = desired;
      }
    }

    if (dto.voice_id !== undefined) {
      script.voice_id = dto.voice_id ?? null;
    }

    if ((dto as any).video_url !== undefined) {
      const cleanedVideoUrl = String((dto as any).video_url ?? '').trim();
      script.video_url = cleanedVideoUrl ? cleanedVideoUrl : null;
    }

    if ((dto as any).youtube_url !== undefined) {
      const cleanedYoutubeUrl = String((dto as any).youtube_url ?? '').trim();
      script.youtube_url = cleanedYoutubeUrl ? cleanedYoutubeUrl : null;
    }

    if ((dto as any).facebook_url !== undefined) {
      const cleanedFacebookUrl = String((dto as any).facebook_url ?? '').trim();
      script.facebook_url = cleanedFacebookUrl ? cleanedFacebookUrl : null;
    }

    if ((dto as any).instagram_url !== undefined) {
      const cleanedInstagramUrl = String(
        (dto as any).instagram_url ?? '',
      ).trim();
      script.instagram_url = cleanedInstagramUrl ? cleanedInstagramUrl : null;
    }

    if ((dto as any).tiktok_url !== undefined) {
      const cleanedTiktokUrl = String((dto as any).tiktok_url ?? '').trim();
      script.tiktok_url = cleanedTiktokUrl ? cleanedTiktokUrl : null;
    }

    await this.scriptRepository.save(script);

    if (dto.sentences !== undefined) {
      await this.sentenceRepository.delete({ script_id: script.id });

      if (dto.sentences.length > 0) {
        const normalizedSentenceInputs =
          await this.normalizeDetachedSoundEffectsForSentenceInputs({
            userId,
            sentenceInputs: dto.sentences as any,
          });
        let suspenseAlreadyUsed = false;
        const sentenceEntities = normalizedSentenceInputs.map((s, index) => {
          const wantsSuspense = Boolean(s.isSuspense);
          const isSuspense = wantsSuspense && !suspenseAlreadyUsed;
          if (isSuspense) suspenseAlreadyUsed = true;

          return this.sentenceRepository.create({
            text: s.text,
            index,
            script_id: script.id,
            align_sound_effects_to_scene_end: Boolean(
              s.align_sound_effects_to_scene_end,
            ),
            image_id: s.image_id ?? null,
            secondary_image_id: s.secondary_image_id ?? null,
            start_frame_image_id: s.start_frame_image_id ?? null,
            end_frame_image_id: s.end_frame_image_id ?? null,
            video_id: s.video_id ?? null,
            text_background_image_id: s.text_background_image_id ?? null,
            text_background_video_id: s.text_background_video_id ?? null,
            overlay_id: this.normalizeOptionalId(s.overlay_id),
            voice_over_url: String(s.voice_over_url ?? '').trim() || null,
            voice_over_mime_type:
              String(s.voice_over_mime_type ?? '').trim() || null,
            voice_over_duration_seconds: this.normalizeOptionalNumber(
              s.voice_over_duration_seconds,
            ),
            voice_over_provider:
              String(s.voice_over_provider ?? '').trim() || null,
            voice_over_voice_id:
              String(s.voice_over_voice_id ?? '').trim() || null,
            voice_over_voice_name:
              String(s.voice_over_voice_name ?? '').trim() || null,
            voice_over_style_instructions:
              String(s.voice_over_style_instructions ?? '').trim() || null,
            eleven_labs_settings:
              this.normalizeElevenLabsVoiceSettingsInput(
                s.eleven_labs_settings,
              ) ?? null,
            video_prompt: String(s.video_prompt ?? '').trim() || null,
            transition_to_next: s.transition_to_next ?? null,
            visual_effect: s.visual_effect ?? null,
            image_motion_effect: s.image_motion_effect ?? 'default',
            image_motion_speed: this.normalizeImageMotionSpeed(
              s.image_motion_speed,
            ),
            image_effects_mode: this.normalizeImageEffectsMode(
              s.image_effects_mode,
            ),
            scene_tab: this.normalizeSceneTab(s.scene_tab),
            image_filter_id: this.normalizeOptionalId(s.image_filter_id),
            image_filter_settings: this.normalizeSettingsObject(
              s.image_filter_settings,
            ),
            motion_effect_id: this.normalizeOptionalId(s.motion_effect_id),
            image_motion_settings: this.normalizeSettingsObject(
              s.image_motion_settings,
            ),
            text_animation_text: this.normalizeTextAnimationText(
              s.text_animation_text,
            ),
            text_animation_effect: this.normalizeTextAnimationEffect(
              s.text_animation_effect,
            ),
            text_animation_id: this.normalizeOptionalId(s.text_animation_id),
            text_animation_settings: this.normalizeTextAnimationSettingsObject(
              s.text_animation_settings,
            ),
            text_animation_sound_effects:
              this.normalizeStoredDetachedSoundEffects(
                s.text_animation_sound_effects,
              ),
            overlay_settings: this.normalizeSettingsObject(s.overlay_settings),
            overlay_sound_effects: this.normalizeStoredDetachedSoundEffects(
              s.overlay_sound_effects,
            ),
            transition_sound_effects: this.normalizeTransitionSoundEffectsInput(
              s.transition_sound_effects,
            ),
            isSuspense,
            forced_character_keys:
              Array.isArray(s.forced_character_keys) &&
              s.forced_character_keys.length > 0
                ? s.forced_character_keys
                : null,
            character_keys:
              Array.isArray(s.character_keys) && s.character_keys.length > 0
                ? s.character_keys
                : null,
            location_key: String(s.location_key ?? '').trim() || null,
            forced_location_key:
              String(s.forced_location_key ?? '').trim() || null,
          });
        });
        const savedSentences =
          await this.sentenceRepository.save(sentenceEntities);
        await this.saveSentenceSoundEffectsForSentenceInputs({
          userId,
          sentenceInputs: normalizedSentenceInputs,
          savedSentences,
        });
      }
    }

    const normalizedShortIds = this.normalizeShortIdsPayload(
      (dto as any).shorts_script_ids,
    );
    const normalizedShorts = this.normalizeShortsPayload(
      (dto as any).shorts_scripts,
    );

    if (normalizedShortIds !== null) {
      await this.applyShortScriptIdsLinking({
        userId,
        parent: script,
        shortIds: normalizedShortIds,
      });
    } else if (normalizedShorts !== null) {
      if (normalizedShorts.length === 0) {
        const existingIds = Array.isArray((script as any).shorts_scripts)
          ? ((script as any).shorts_scripts as string[])
          : [];
        if (existingIds.length > 0) {
          await this.deleteShortScriptsByIds(userId, existingIds);
        }
        (script as any).shorts_scripts = null;
        await this.scriptRepository.save(script);
      } else {
        await this.syncShortScripts({
          userId,
          parent: script,
          shorts: normalizedShorts,
        });
      }
    }

    return this.findOne(id, userId);
  }

  async translateToDraft(
    id: string,
    userId: string,
    dto: TranslateScriptDto,
  ): Promise<Script> {
    await this.ensureScriptsSchemaLazy();

    const targetLanguage = String(dto?.targetLanguage ?? '').trim();
    if (!targetLanguage) {
      throw new BadRequestException('targetLanguage is required');
    }

    const source = await this.scriptRepository.findOne({
      where: { id, user_id: userId },
    });

    if (!source) {
      throw new NotFoundException('Script not found');
    }

    const sourceSentences = await this.sentenceRepository.find({
      where: { script_id: source.id },
      order: { index: 'ASC' },
    });

    const hasSentences = sourceSentences.length > 0;

    let translatedScriptText = '';
    let translatedSentences: string[] | null = null;

    if (hasSentences) {
      const sentenceTexts = sourceSentences.map((s) => String(s.text ?? ''));
      const result = await this.aiService.translate({
        targetLanguage,
        method: dto.method,
        model: dto.model,
        sentences: sentenceTexts,
      });

      if (!Array.isArray(result?.sentences)) {
        throw new InternalServerErrorException(
          'Translation failed: expected sentences array',
        );
      }

      if (result.sentences.length !== sentenceTexts.length) {
        throw new InternalServerErrorException(
          'Translation failed: sentence count mismatch',
        );
      }

      translatedSentences = result.sentences;
      translatedScriptText = translatedSentences.join('\n');
    } else {
      const sourceText = String(source.script ?? '').trim();
      if (!sourceText) {
        throw new BadRequestException('Script text is empty');
      }

      const result = await this.aiService.translate({
        targetLanguage,
        method: dto.method,
        model: dto.model,
        script: sourceText,
      });

      const translated = String(result?.script ?? '').trim();
      if (!translated) {
        throw new InternalServerErrorException(
          'Translation failed: expected script text',
        );
      }
      translatedScriptText = translated;
    }

    const savedDraft = await this.dataSource.transaction(async (manager) => {
      const scriptRepo = manager.getRepository(Script);
      const sentenceRepo = manager.getRepository(Sentence);
      const groupRepo = manager.getRepository(ScriptTranslationGroup);

      const draft = scriptRepo.create({
        user_id: userId,
        language: targetLanguage,
        title: source.title ?? null,
        script: translatedScriptText,
        subject: source.subject ?? null,
        subject_content: source.subject_content ?? null,
        length: source.length ?? null,
        style: source.style ?? null,
        technique: source.technique ?? null,
        characters: source.characters ?? null,
        locations: (source as any).locations ?? null,
        isShortScript: Boolean(source.isShortScript),
        shorts_scripts: null,
        message_id: null,
        voice_id: null,
        video_url: null,
        youtube_url: null,
        facebook_url: null,
        instagram_url: null,
        tiktok_url: null,
      });

      const saved = await scriptRepo.save(draft);

      if (hasSentences) {
        let suspenseAlreadyUsed = false;
        const sentenceEntities = sourceSentences.map((s, idx) => {
          const wantsSuspense = Boolean(s.isSuspense);
          const isSuspense = wantsSuspense && !suspenseAlreadyUsed;
          if (isSuspense) suspenseAlreadyUsed = true;

          return sentenceRepo.create({
            script_id: saved.id,
            index: s.index ?? idx,
            text: String(translatedSentences?.[idx] ?? ''),
            align_sound_effects_to_scene_end: Boolean(
              (s as any).align_sound_effects_to_scene_end,
            ),
            image_id: s.image_id ?? null,
            secondary_image_id: s.secondary_image_id ?? null,
            start_frame_image_id: s.start_frame_image_id ?? null,
            end_frame_image_id: s.end_frame_image_id ?? null,
            video_id: s.video_id ?? null,
            text_background_image_id:
              (s as any).text_background_image_id ?? null,
            text_background_video_id:
              (s as any).text_background_video_id ?? null,
            overlay_id: this.normalizeOptionalId((s as any).overlay_id),
            video_prompt: s.video_prompt ?? null,
            transition_to_next: s.transition_to_next ?? null,
            visual_effect: s.visual_effect ?? null,
            image_motion_effect: s.image_motion_effect ?? 'default',
            image_motion_speed: this.normalizeImageMotionSpeed(
              s.image_motion_speed,
            ),
            image_effects_mode: this.normalizeImageEffectsMode(
              (s as any).image_effects_mode,
            ),
            scene_tab: this.normalizeSceneTab((s as any).scene_tab),
            image_filter_id: this.normalizeOptionalId(
              (s as any).image_filter_id,
            ),
            image_filter_settings: this.normalizeSettingsObject(
              (s as any).image_filter_settings,
            ),
            motion_effect_id: this.normalizeOptionalId(
              (s as any).motion_effect_id,
            ),
            image_motion_settings: this.normalizeSettingsObject(
              (s as any).image_motion_settings,
            ),
            text_animation_text: this.normalizeTextAnimationText(
              (s as any).text_animation_text,
            ),
            text_animation_effect: this.normalizeTextAnimationEffect(
              (s as any).text_animation_effect,
            ),
            text_animation_id: this.normalizeOptionalId(
              (s as any).text_animation_id,
            ),
            text_animation_settings: this.normalizeTextAnimationSettingsObject(
              (s as any).text_animation_settings,
            ),
            text_animation_sound_effects:
              this.normalizeStoredDetachedSoundEffects(
                (s as any).text_animation_sound_effects,
              ),
            overlay_settings: this.normalizeSettingsObject(
              (s as any).overlay_settings,
            ),
            overlay_sound_effects: this.normalizeStoredDetachedSoundEffects(
              (s as any).overlay_sound_effects,
            ),
            transition_sound_effects: this.normalizeTransitionSoundEffectsInput(
              (s as any).transition_sound_effects,
            ),
            isSuspense,
            forced_character_keys: s.forced_character_keys ?? null,
            character_keys: s.character_keys ?? null,
            location_key: (s as any).location_key ?? null,
            forced_location_key: (s as any).forced_location_key ?? null,
          });
        });

        await sentenceRepo.save(sentenceEntities);
      }

      // Translation grouping is created/updated when saving a translated draft.
      // Reuse an existing group if the source is already part of one.
      let group = await groupRepo
        .createQueryBuilder('g')
        .innerJoin('g.scripts', 's', 's.id = :scriptId', {
          scriptId: source.id,
        })
        .where('g.user_id = :userId', { userId })
        .getOne();

      if (!group) {
        group = await groupRepo.save(groupRepo.create({ user_id: userId }));
      }

      const groupWithScripts = await groupRepo.findOne({
        where: { id: group.id, user_id: userId },
        relations: ['scripts'],
      });

      if (groupWithScripts) {
        const uniqueById = new Map<string, Script>();
        for (const s of groupWithScripts.scripts ?? []) uniqueById.set(s.id, s);
        uniqueById.set(source.id, source);
        uniqueById.set(saved.id, saved);
        groupWithScripts.scripts = Array.from(uniqueById.values());
        await groupRepo.save(groupWithScripts);
      }

      return saved;
    });

    return this.findOne(savedDraft.id, userId);
  }

  async remove(id: string, userId: string): Promise<{ deleted: true }> {
    const existing = await this.scriptRepository.findOne({
      where: { id, user_id: userId },
    });

    if (!existing) {
      throw new NotFoundException('Script not found');
    }

    await this.sentenceRepository.delete({ script_id: id });
    await this.scriptRepository.delete({ id, user_id: userId });
    return { deleted: true };
  }
}
