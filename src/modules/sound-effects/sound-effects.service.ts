import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, Repository } from 'typeorm';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { RenderInternals } from '@remotion/renderer';
import { SoundEffect } from './entities/sound-effect.entity';
import { downloadUrlToBuffer } from '../render-videos/utils/net.utils';
import type { MergeSoundEffectItemDto } from './dto/merge-sound-effects.dto';
import {
  DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS,
  normalizeSoundEffectAudioSettings,
  type SoundEffectAudioSettings,
} from './audio-settings.types';
import { UploadsService } from '../uploads/uploads.service';
import { shouldRunStartupTasks } from '../../common/runtime/runtime.utils';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const clampPercent = (v: number) => Math.max(0, Math.min(300, v));
const COMPRESSOR_MIN_THRESHOLD = 0.000976563;

type MergeSoundEffectRenderItem = {
  delayMs: number;
  volume: number;
  trimStartSeconds: number;
  trimDurationSeconds: number | null;
  audioSettings: SoundEffectAudioSettings;
};

type MergeSoundEffectMergedFromItem = {
  sound_effect_id: string;
  delay_seconds: number;
  volume_percent: number;
  trim_start_seconds: number;
  duration_seconds: number | null;
  audio_settings_override: SoundEffectAudioSettings;
};

type ResolveMergeSoundEffectRenderItemParams = {
  item: MergeSoundEffectItemDto;
  sourceDefaults?: {
    volumePercent?: number | null;
    audioSettings?: unknown;
  };
};

const formatFilterNumber = (value: number, digits = 6) => {
  if (!Number.isFinite(value)) return '0';
  return Number(value.toFixed(digits)).toString();
};

const shouldApplyGainDb = (value: number) => Math.abs(value) >= 0.001;

const toCompressorThresholdLinear = (thresholdDb: number) => {
  if (!Number.isFinite(thresholdDb)) return 0.125;
  return Math.max(
    COMPRESSOR_MIN_THRESHOLD,
    Math.min(1, Math.pow(10, Math.min(0, thresholdDb) / 20)),
  );
};

const toCompressorKneeValue = (knee: number) => {
  const safeKnee = Number.isFinite(knee) ? Math.max(0, Math.min(40, knee)) : 0;
  return 1 + (safeKnee / 40) * 7;
};

type DelayTap = {
  delayMs: number;
  gain: number;
};

const buildEchoTaps = (
  settings: SoundEffectAudioSettings['echo'],
): DelayTap[] => {
  if (!settings.enabled || settings.mix <= 0) return [];

  const delayMs = Math.max(20, Math.round(settings.delayMs));
  const feedback = Math.max(0, Math.min(0.95, settings.feedback));
  let gain = Math.max(0, Math.min(1, settings.mix));
  const taps: DelayTap[] = [];

  for (let repeatIndex = 1; repeatIndex <= 16; repeatIndex += 1) {
    if (gain < 0.005) break;
    taps.push({
      delayMs: delayMs * repeatIndex,
      gain,
    });

    if (feedback <= 0.001) break;
    gain *= feedback;
  }

  return taps;
};

const buildReverbTaps = (
  settings: SoundEffectAudioSettings['reverb'],
): DelayTap[] => {
  if (!settings.enabled || settings.mix <= 0) return [];

  const durationSeconds = Math.max(0.1, Math.min(8, settings.duration));
  const decay = Math.max(0.1, Math.min(8, settings.decay));
  const mix = Math.max(0, Math.min(1, settings.mix));
  const tapCount = Math.max(4, Math.min(12, Math.round(durationSeconds * 2)));
  const taps: DelayTap[] = [];

  for (let index = 0; index < tapCount; index += 1) {
    const progress = (index + 1) / (tapCount + 1);
    const gain = mix * Math.pow(1 - progress, decay);
    if (gain < 0.005) continue;

    taps.push({
      delayMs: Math.max(20, Math.round(durationSeconds * 1000 * progress)),
      gain,
    });
  }

  return taps;
};

const appendTapMixFilters = (params: {
  parts: string[];
  inputLabel: string;
  outputLabel: string;
  scratchPrefix: string;
  taps: DelayTap[];
}) => {
  const taps = params.taps.filter(
    (tap) => tap.delayMs > 0 && Number.isFinite(tap.gain) && tap.gain > 0,
  );
  if (taps.length === 0) return;

  if (taps.length === 1) {
    const [tap] = taps;
    params.parts.push(
      `[${params.inputLabel}]adelay=${tap.delayMs}:all=1,volume=${formatFilterNumber(tap.gain)}[${params.outputLabel}]`,
    );
    return;
  }

  const tapSourceLabels = taps.map(
    (_tap, index) => `${params.scratchPrefix}_src${index}`,
  );
  const tapOutputLabels = taps.map(
    (_tap, index) => `${params.scratchPrefix}_out${index}`,
  );

  params.parts.push(
    `[${params.inputLabel}]asplit=${taps.length}${tapSourceLabels
      .map((label) => `[${label}]`)
      .join('')}`,
  );

  taps.forEach((tap, index) => {
    params.parts.push(
      `[${tapSourceLabels[index]}]adelay=${tap.delayMs}:all=1,volume=${formatFilterNumber(tap.gain)}[${tapOutputLabels[index]}]`,
    );
  });

  params.parts.push(
    `${tapOutputLabels.map((label) => `[${label}]`).join('')}amix=inputs=${taps.length}:normalize=0[${params.outputLabel}]`,
  );
};

export const resolveMergeSoundEffectRenderItem = ({
  item,
  sourceDefaults,
}: ResolveMergeSoundEffectRenderItemParams): MergeSoundEffectRenderItem & {
  mergedFromItem: MergeSoundEffectMergedFromItem;
} => {
  const normalizedAudioSettings = normalizeSoundEffectAudioSettings(
    item.audio_settings_override ??
      sourceDefaults?.audioSettings ??
      DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS,
  );
  const rawDelaySeconds = Number(item.delay_seconds ?? 0);
  const rawVolumePercent = Number(
    item.volume_percent ?? sourceDefaults?.volumePercent ?? 100,
  );
  const rawTrimStartSeconds = Number(
    item.trim_start_seconds ?? normalizedAudioSettings.trim.startSeconds ?? 0,
  );
  const rawTrimDurationSeconds = Number(
    item.duration_seconds ?? normalizedAudioSettings.trim.durationSeconds ?? 0,
  );

  const delaySeconds = Number.isFinite(rawDelaySeconds)
    ? Math.max(0, rawDelaySeconds)
    : 0;
  const volumePercent = Number.isFinite(rawVolumePercent)
    ? clampPercent(rawVolumePercent)
    : 100;
  const trimStartSeconds = Number.isFinite(rawTrimStartSeconds)
    ? Math.max(0, rawTrimStartSeconds)
    : 0;
  const trimDurationSeconds =
    Number.isFinite(rawTrimDurationSeconds) && rawTrimDurationSeconds > 0
      ? Math.max(0, rawTrimDurationSeconds)
      : null;

  const effectiveAudioSettings: SoundEffectAudioSettings = {
    ...normalizedAudioSettings,
    trim: {
      startSeconds: trimStartSeconds,
      durationSeconds: trimDurationSeconds ?? 0,
    },
  };

  return {
    delayMs: Math.round(delaySeconds * 1000),
    volume: clamp01(volumePercent / 100),
    trimStartSeconds,
    trimDurationSeconds,
    audioSettings: effectiveAudioSettings,
    mergedFromItem: {
      sound_effect_id: item.sound_effect_id,
      delay_seconds: delaySeconds,
      volume_percent: volumePercent,
      trim_start_seconds: trimStartSeconds,
      duration_seconds: trimDurationSeconds,
      audio_settings_override: effectiveAudioSettings,
    },
  };
};

export const buildMergedSoundEffectsFilterGraph = (params: {
  items: MergeSoundEffectRenderItem[];
}): { filterComplex: string; outLabel: string } => {
  const parts: string[] = [];
  const outLabels: string[] = [];

  params.items.forEach((item, index) => {
    const outputLabel = `a${index}`;
    const scratchPrefix = `m${index}`;
    let currentLabel = `${index}:a`;

    const applySerialFilters = (filters: string[], suffix: string) => {
      if (filters.length === 0) return;

      const nextLabel = `${scratchPrefix}_${suffix}`;
      parts.push(`[${currentLabel}]${filters.join(',')}[${nextLabel}]`);
      currentLabel = nextLabel;
    };

    if (
      item.trimStartSeconds > 0 ||
      (item.trimDurationSeconds !== null && item.trimDurationSeconds > 0)
    ) {
      const trimArgs: string[] = [];
      if (item.trimStartSeconds > 0) {
        trimArgs.push(`start=${formatFilterNumber(item.trimStartSeconds)}`);
      }
      if (item.trimDurationSeconds !== null && item.trimDurationSeconds > 0) {
        trimArgs.push(`duration=${formatFilterNumber(item.trimDurationSeconds)}`);
      }
      applySerialFilters(
        [`atrim=${trimArgs.join(':')}`, 'asetpts=PTS-STARTPTS'],
        'trim',
      );
    }

    if (shouldApplyGainDb(item.audioSettings.eq.lowGainDb)) {
      applySerialFilters(
        [
          `bass=f=${formatFilterNumber(item.audioSettings.eq.lowFrequencyHz)}:t=q:w=0.707107:g=${formatFilterNumber(item.audioSettings.eq.lowGainDb)}`,
        ],
        'eq_low',
      );
    }

    if (shouldApplyGainDb(item.audioSettings.eq.midGainDb)) {
      applySerialFilters(
        [
          `equalizer=f=${formatFilterNumber(item.audioSettings.eq.midFrequencyHz)}:t=q:w=${formatFilterNumber(item.audioSettings.eq.midQ)}:g=${formatFilterNumber(item.audioSettings.eq.midGainDb)}`,
        ],
        'eq_mid',
      );
    }

    if (shouldApplyGainDb(item.audioSettings.eq.highGainDb)) {
      applySerialFilters(
        [
          `treble=f=${formatFilterNumber(item.audioSettings.eq.highFrequencyHz)}:t=q:w=0.707107:g=${formatFilterNumber(item.audioSettings.eq.highGainDb)}`,
        ],
        'eq_high',
      );
    }

    if (item.audioSettings.compressor.enabled) {
      applySerialFilters(
        [
          `acompressor=threshold=${formatFilterNumber(toCompressorThresholdLinear(item.audioSettings.compressor.threshold))}:ratio=${formatFilterNumber(item.audioSettings.compressor.ratio)}:attack=${formatFilterNumber(item.audioSettings.compressor.attack * 1000)}:release=${formatFilterNumber(item.audioSettings.compressor.release * 1000)}:knee=${formatFilterNumber(toCompressorKneeValue(item.audioSettings.compressor.knee))}:mix=1:detection=rms:link=average`,
        ],
        'compressor',
      );
    }

    const echoTaps = buildEchoTaps(item.audioSettings.echo);
    const reverbTaps = buildReverbTaps(item.audioSettings.reverb);
    const enableSaturation =
      item.audioSettings.saturation.enabled && item.audioSettings.saturation.mix > 0;
    const branchLabels = [
      `${scratchPrefix}_dry`,
      ...(enableSaturation ? [`${scratchPrefix}_sat_base`] : []),
      ...(echoTaps.length > 0 ? [`${scratchPrefix}_echo_base`] : []),
      ...(reverbTaps.length > 0 ? [`${scratchPrefix}_reverb_base`] : []),
    ];

    if (branchLabels.length > 1) {
      parts.push(
        `[${currentLabel}]asplit=${branchLabels.length}${branchLabels
          .map((label) => `[${label}]`)
          .join('')}`,
      );

      const mixInputs = [`[${branchLabels[0]}]`];
      let branchIndex = 1;

      if (enableSaturation) {
        const saturationBaseLabel = branchLabels[branchIndex];
        const saturationLabel = `${scratchPrefix}_sat`;
        const driveGain = 1 + (item.audioSettings.saturation.drive - 1) * 0.35;
        const outputCompensation = driveGain > 0 ? 1 / driveGain : 1;
        const clipParam = 1 + ((item.audioSettings.saturation.drive - 1) / 9) * 1.5;

        parts.push(
          `[${saturationBaseLabel}]volume=${formatFilterNumber(driveGain)},asoftclip=type=tanh:threshold=1:output=${formatFilterNumber(outputCompensation)}:param=${formatFilterNumber(clipParam)}:oversample=4,volume=${formatFilterNumber(item.audioSettings.saturation.mix)}[${saturationLabel}]`,
        );
        mixInputs.push(`[${saturationLabel}]`);
        branchIndex += 1;
      }

      if (echoTaps.length > 0) {
        const echoBaseLabel = branchLabels[branchIndex];
        const echoLabel = `${scratchPrefix}_echo`;
        appendTapMixFilters({
          parts,
          inputLabel: echoBaseLabel,
          outputLabel: echoLabel,
          scratchPrefix: `${scratchPrefix}_echo`,
          taps: echoTaps,
        });
        mixInputs.push(`[${echoLabel}]`);
        branchIndex += 1;
      }

      if (reverbTaps.length > 0) {
        const reverbBaseLabel = branchLabels[branchIndex];
        const reverbLabel = `${scratchPrefix}_reverb`;
        appendTapMixFilters({
          parts,
          inputLabel: reverbBaseLabel,
          outputLabel: reverbLabel,
          scratchPrefix: `${scratchPrefix}_reverb`,
          taps: reverbTaps,
        });
        mixInputs.push(`[${reverbLabel}]`);
      }

      const mixedLabel = `${scratchPrefix}_wetmix`;
      parts.push(
        `${mixInputs.join('')}amix=inputs=${mixInputs.length}:normalize=0[${mixedLabel}]`,
      );
      currentLabel = mixedLabel;
    }

    parts.push(
      `[${currentLabel}]adelay=${Math.max(0, Math.round(item.delayMs))}:all=1,volume=${formatFilterNumber(item.volume)},aresample=async=1[${outputLabel}]`,
    );
    outLabels.push(`[${outputLabel}]`);
  });

  const mixLabel = 'mix';
  parts.push(
    `${outLabels.join('')}amix=inputs=${params.items.length}:normalize=0[${mixLabel}]`,
  );

  return { filterComplex: parts.join(';'), outLabel: mixLabel };
};

@Injectable()
export class SoundEffectsService implements OnModuleInit {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(SoundEffect)
    private readonly repo: Repository<SoundEffect>,
    private readonly uploadsService: UploadsService,
  ) {}

  async onModuleInit() {
    if (!shouldRunStartupTasks()) {
      return;
    }

    await this.ensureSoundEffectsSchema();
  }

  private async soundEffectsTableExists(): Promise<boolean> {
    try {
      const rows = await this.dataSource.query(
        "SELECT to_regclass('sound_effects') as reg",
      );
      return Boolean(rows?.[0]?.reg);
    } catch {
      return false;
    }
  }

  private async ensureSoundEffectsSchema() {
    const tableExists = await this.soundEffectsTableExists();
    if (!tableExists) return;

    const queries = [
      'ALTER TABLE sound_effects ADD COLUMN IF NOT EXISTS is_transition_sound BOOLEAN NOT NULL DEFAULT false',
      'ALTER TABLE sound_effects ADD COLUMN IF NOT EXISTS from_favorites BOOLEAN NOT NULL DEFAULT false',
      'ALTER TABLE sound_effects ADD COLUMN IF NOT EXISTS duration_seconds DOUBLE PRECISION NULL',
      'ALTER TABLE sound_effects ADD COLUMN IF NOT EXISTS audio_settings JSONB NULL',
      'ALTER TABLE sound_effects ADD COLUMN IF NOT EXISTS is_preset BOOLEAN NOT NULL DEFAULT false',
      'ALTER TABLE sound_effects ADD COLUMN IF NOT EXISTS source_sound_effect_id UUID NULL',
    ];

    for (const query of queries) {
      try {
        await this.dataSource.query(query);
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
  }

  private normalizeStoredSoundEffect(entity: SoundEffect): SoundEffect {
    entity.audio_settings = normalizeSoundEffectAudioSettings(
      entity.audio_settings ?? DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS,
    );
    entity.fromFavorites = Boolean(entity.fromFavorites);
    const name =
      String(entity?.name ?? '').trim() ||
      String(entity?.title ?? '').trim() ||
      'Sound Effect';
    entity.name = name;
    entity.title = String(entity?.title ?? '').trim() || name;
    return entity;
  }

  private async findOwnedSoundEffectOrThrow(params: {
    user_id: string;
    soundEffectId: string;
  }): Promise<SoundEffect> {
    const soundEffectId = String(params.soundEffectId ?? '').trim();
    if (!soundEffectId) throw new NotFoundException('Sound effect not found');

    const target = await this.repo.findOne({
      where: { id: soundEffectId, user_id: params.user_id },
    });

    if (!target) throw new NotFoundException('Sound effect not found');
    return target;
  }

  private async assertTitleAvailable(params: {
    user_id: string;
    name: string;
    excludeId?: string | null;
  }): Promise<void> {
    const normalizedName = String(params.name ?? '').trim();
    if (!normalizedName) throw new BadRequestException('Name is required');

    const query = this.repo
      .createQueryBuilder('sound_effect')
      .where('sound_effect.user_id = :userId', { userId: params.user_id })
      .andWhere(
        "(LOWER(COALESCE(sound_effect.name, '')) = LOWER(:name) OR LOWER(sound_effect.title) = LOWER(:name))",
        { name: normalizedName },
      );

    const excludeId = String(params.excludeId ?? '').trim();
    if (excludeId) {
      query.andWhere('sound_effect.id != :excludeId', { excludeId });
    }

    const existing = await query.getOne();
    if (existing) {
      throw new BadRequestException(
        'A sound effect with this title already exists',
      );
    }
  }

  private async getAudioDurationSecondsFromFile(
    filePath: string,
  ): Promise<number | null> {
    try {
      const command: any = RenderInternals.callFf({
        bin: 'ffprobe',
        args: [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          filePath,
        ],
        indent: false,
        logLevel: 'error',
        binariesDirectory: null,
        cancelSignal: undefined,
      });

      const result = await command;
      const raw = String(result?.stdout ?? '').trim();
      const duration = Number(raw);
      if (!Number.isFinite(duration) || duration <= 0) return null;
      return duration;
    } catch {
      return null;
    }
  }

  private async getAudioDurationSecondsFromBuffer(params: {
    buffer: Buffer;
    ext?: string;
  }): Promise<number | null> {
    const tmpDir = path.join(
      os.tmpdir(),
      `auto-video-sfx-duration-${randomUUID()}`,
    );
    fs.mkdirSync(tmpDir, { recursive: true });

    const ext = String(params.ext ?? '').trim() || '.mp3';
    const tempFilePath = path.join(
      tmpDir,
      `audio${ext.startsWith('.') ? ext : `.${ext}`}`,
    );

    try {
      fs.writeFileSync(tempFilePath, params.buffer);
      return await this.getAudioDurationSecondsFromFile(tempFilePath);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failures
      }
    }
  }

  private async backfillMissingDurationSeconds(items: SoundEffect[]) {
    const list = (Array.isArray(items) ? items : []).filter(
      (item) =>
        item &&
        (item.duration_seconds === null ||
          item.duration_seconds === undefined) &&
        String(item.url ?? '').trim(),
    );

    if (list.length === 0) return;

    await Promise.allSettled(
      list.map(async (item) => {
        try {
          const downloaded = await downloadUrlToBuffer({
            url: item.url,
            maxBytes: 25 * 1024 * 1024,
            label: `sound effect duration ${item.id}`,
          });

          const durationSeconds = await this.getAudioDurationSecondsFromBuffer({
            buffer: downloaded.buffer,
            ext:
              this.inferExtFromMime(downloaded.mimeType ?? '') ||
              path.extname(item.url.split('?')[0] || '') ||
              '.mp3',
          });

          if (!durationSeconds) return;
          item.duration_seconds = durationSeconds;
          await this.repo.save(item);
        } catch {
          // Ignore best-effort backfill failures.
        }
      }),
    );
  }

  async findAllByUser(
    user_id: string,
    page = 1,
    limit = 20,
    q?: string,
  ): Promise<{
    items: SoundEffect[];
    total: number;
    page: number;
    limit: number;
  }> {
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    // Fixed page size for this resource.
    void limit;
    const safeLimit = 20;

    const search = String(q ?? '').trim();

    const where: any =
      search.length > 0
        ? [
            { user_id, name: ILike(`%${search}%`) },
            { user_id, title: ILike(`%${search}%`) },
          ]
        : { user_id };

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { fromFavorites: 'DESC', created_at: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    await this.backfillMissingDurationSeconds(items);

    // Backfill name in-memory for rows created before `name` existed.
    const normalized = items.map((it: any) => {
      const name =
        String(it?.name ?? '').trim() ||
        String(it?.title ?? '').trim() ||
        'Sound Effect';
      return this.normalizeStoredSoundEffect({ ...it, name } as SoundEffect);
    });

    return {
      items: normalized as any,
      total,
      page: safePage,
      limit: safeLimit,
    };
  }

  async findTransitionSoundsByUser(
    user_id: string,
    page = 1,
    q?: string,
  ): Promise<{
    items: SoundEffect[];
    total: number;
    page: number;
    limit: number;
  }> {
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit = 10;
    const search = String(q ?? '').trim();

    const where: any =
      search.length > 0
        ? [
            { user_id, is_transition_sound: true, name: ILike(`%${search}%`) },
            { user_id, is_transition_sound: true, title: ILike(`%${search}%`) },
          ]
        : { user_id, is_transition_sound: true };

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { fromFavorites: 'DESC', created_at: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    await this.backfillMissingDurationSeconds(items);

    const normalized = items.map((it: any) => {
      const name =
        String(it?.name ?? '').trim() ||
        String(it?.title ?? '').trim() ||
        'Sound Effect';
      return this.normalizeStoredSoundEffect({ ...it, name } as SoundEffect);
    });

    return {
      items: normalized as any,
      total,
      page: safePage,
      limit: safeLimit,
    };
  }

  async setVolumeById(params: {
    user_id: string;
    soundEffectId: string;
    volumePercent: number;
  }): Promise<SoundEffect> {
    const soundEffectId = String(params.soundEffectId ?? '').trim();
    if (!soundEffectId) throw new NotFoundException('Sound effect not found');

    const raw = Number(params.volumePercent);
    const volumePercent = Number.isFinite(raw) ? clampPercent(raw) : 100;

    const target = await this.repo.findOne({
      where: { id: soundEffectId, user_id: params.user_id },
    });

    if (!target) throw new NotFoundException('Sound effect not found');

    target.volume_percent = volumePercent;
    return this.repo.save(target);
  }

  async setTransitionSoundById(params: {
    user_id: string;
    soundEffectId: string;
    isTransitionSound: boolean;
    volumePercent?: number;
  }): Promise<SoundEffect> {
    const soundEffectId = String(params.soundEffectId ?? '').trim();
    if (!soundEffectId) throw new NotFoundException('Sound effect not found');

    const target = await this.repo.findOne({
      where: { id: soundEffectId, user_id: params.user_id },
    });

    if (!target) throw new NotFoundException('Sound effect not found');

    target.is_transition_sound = Boolean(params.isTransitionSound);
    const rawVolume = Number(params.volumePercent);
    if (Number.isFinite(rawVolume)) {
      target.volume_percent = clampPercent(rawVolume);
    }

    return this.normalizeStoredSoundEffect(await this.repo.save(target));
  }

  async toggleFavoriteById(params: {
    user_id: string;
    soundEffectId: string;
  }): Promise<SoundEffect> {
    const target = await this.findOwnedSoundEffectOrThrow(params);
    target.fromFavorites = !target.fromFavorites;
    return this.normalizeStoredSoundEffect(await this.repo.save(target));
  }

  async updateById(params: {
    user_id: string;
    soundEffectId: string;
    name: string;
    volumePercent?: number;
    audioSettings?: Record<string, unknown> | null;
  }): Promise<SoundEffect> {
    const name = String(params.name ?? '').trim();
    if (!name) throw new BadRequestException('Name is required');

    const target = await this.findOwnedSoundEffectOrThrow(params);
    await this.assertTitleAvailable({
      user_id: params.user_id,
      name,
      excludeId: target.id,
    });

    const rawVolume = Number(params.volumePercent);
    const volumePercent = Number.isFinite(rawVolume)
      ? clampPercent(rawVolume)
      : (target.volume_percent ?? 100);

    (target as any).name = name;
    target.title = name;
    target.volume_percent = volumePercent;
    target.audio_settings = normalizeSoundEffectAudioSettings(
      params.audioSettings ??
        target.audio_settings ??
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS,
    );
    return this.normalizeStoredSoundEffect(await this.repo.save(target));
  }

  async saveAsPreset(params: {
    user_id: string;
    soundEffectId: string;
    name: string;
    volumePercent?: number;
    audioSettings?: Record<string, unknown> | null;
  }): Promise<SoundEffect> {
    const source = await this.findOwnedSoundEffectOrThrow(params);
    const name = String(params.name ?? '').trim();
    if (!name) throw new BadRequestException('Name is required');

    await this.assertTitleAvailable({
      user_id: params.user_id,
      name,
      excludeId: source.id,
    });

    const rawVolume = Number(params.volumePercent);
    const volumePercent = Number.isFinite(rawVolume)
      ? clampPercent(rawVolume)
      : (source.volume_percent ?? 100);

    const clone = this.repo.create({
      user_id: source.user_id,
      title: name,
      name,
      url: source.url,
      public_id: source.public_id,
      hash: source.hash,
      number_of_times_used: 0,
      volume_percent: volumePercent,
      duration_seconds: source.duration_seconds,
      audio_settings: normalizeSoundEffectAudioSettings(
        params.audioSettings ??
          source.audio_settings ??
          DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS,
      ),
      is_transition_sound: source.is_transition_sound,
      fromFavorites: false,
      is_merged: false,
      is_preset: true,
      source_sound_effect_id: source.id,
      merged_from: null,
    });

    return this.normalizeStoredSoundEffect(await this.repo.save(clone));
  }

  async deleteById(params: {
    user_id: string;
    soundEffectId: string;
  }): Promise<string> {
    const soundEffectId = String(params.soundEffectId ?? '').trim();
    if (!soundEffectId) throw new NotFoundException('Sound effect not found');

    const target = await this.repo.findOne({
      where: { id: soundEffectId, user_id: params.user_id },
    });

    if (!target) throw new NotFoundException('Sound effect not found');

    const publicId = String((target as any)?.public_id ?? '').trim();
    if (publicId) {
      try {
        await this.uploadsService.deleteByRef({
          providerRef: publicId,
          resourceType: 'audio',
        });
      } catch (error) {
        console.error('Failed to delete sound effect from managed upload', {
          soundEffectId,
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
      folder: 'auto-video-generator/sound-effects',
      resourceType: 'audio',
    });

    return {
      url: uploadResult.url,
      public_id: uploadResult.providerRef,
    };
  }

  async uploadAndCreate(params: {
    user_id: string;
    buffer: Buffer;
    filename: string;
    title?: string;
    name?: string;
    volumePercent?: number;
    audioSettings?: Record<string, unknown> | null;
  }): Promise<SoundEffect> {
    try {
      const hash = crypto
        .createHash('sha256')
        .update(params.buffer)
        .digest('hex');

      const existing = await this.repo.findOne({
        where: { user_id: params.user_id, hash },
      });

      const inferredName =
        path
          .basename(String(params.filename ?? 'sound-effect'))
          .replace(/\.[a-z0-9]+$/i, '')
          .trim() || 'Sound Effect';

      const name = String(params.name ?? '').trim() || inferredName;
      const title = String(params.title ?? '').trim() || name;
      await this.assertTitleAvailable({
        user_id: params.user_id,
        name,
        excludeId: existing?.id ?? null,
      });
      const rawVolume = Number(params.volumePercent);
      const volumePercent = Number.isFinite(rawVolume)
        ? clampPercent(rawVolume)
        : 100;
      const audioSettings = normalizeSoundEffectAudioSettings(
        params.audioSettings ?? DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS,
      );
      const durationSeconds = await this.getAudioDurationSecondsFromBuffer({
        buffer: params.buffer,
        ext: path.extname(String(params.filename ?? '').trim()) || '.mp3',
      });

      if (existing) {
        existing.number_of_times_used += 1;
        if (title) existing.title = title;
        if (name) (existing as any).name = name;
        existing.volume_percent = volumePercent;
        existing.audio_settings = audioSettings;
        if (durationSeconds && !existing.duration_seconds) {
          existing.duration_seconds = durationSeconds;
        }
        return this.normalizeStoredSoundEffect(await this.repo.save(existing));
      }

      const uploaded = await this.uploadAudioToManagedStorage({
        buffer: params.buffer,
        filename: params.filename,
      });

      const entity = this.repo.create({
        user_id: params.user_id,
        title,
        name,
        url: uploaded.url,
        public_id: uploaded.public_id,
        hash,
        number_of_times_used: 0,
        volume_percent: volumePercent,
        duration_seconds: durationSeconds,
        audio_settings: audioSettings,
        fromFavorites: false,
      });

      return this.normalizeStoredSoundEffect(await this.repo.save(entity));
    } catch (error: any) {
      console.error('Error in uploadAndCreate (sound effect):', error);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to save sound effect',
      );
    }
  }

  private inferExtFromMime(mime: string): string {
    const m = String(mime ?? '').toLowerCase();
    if (m.includes('audio/mpeg') || m.includes('audio/mp3')) return '.mp3';
    if (m.includes('audio/wav')) return '.wav';
    if (m.includes('audio/aac')) return '.aac';
    if (m.includes('audio/ogg')) return '.ogg';
    if (m.includes('audio/mp4') || m.includes('audio/x-m4a')) return '.m4a';
    if (m.includes('audio/webm')) return '.webm';
    return '';
  }

  private async callFfmpeg(args: string[]): Promise<void> {
    const renderer: any = await import('@remotion/renderer');
    const task = renderer?.RenderInternals?.callFf?.({
      bin: 'ffmpeg',
      indent: false,
      logLevel: 'warn',
      binariesDirectory: null,
      cancelSignal: undefined,
      args,
    });

    if (!task || typeof task.then !== 'function') {
      throw new Error('Remotion ffmpeg helper not available');
    }

    await task;
  }

  private buildFilterGraph(params: {
    inputCount: number;
    items: MergeSoundEffectRenderItem[];
  }): { filterComplex: string; outLabel: string } {
    const items = params.items.slice(0, params.inputCount);
    return buildMergedSoundEffectsFilterGraph({ items });
  }

  private async renderMergedAudio(params: {
    user_id: string;
    items: MergeSoundEffectItemDto[];
  }): Promise<{
    mergedBuffer: Buffer;
    mergedFilename: string;
    mergedDurationSeconds: number | null;
    mergedFrom: {
      items: Array<{
        sound_effect_id: string;
        delay_seconds: number;
        volume_percent: number;
        trim_start_seconds: number;
        duration_seconds: number | null;
        audio_settings_override: SoundEffectAudioSettings;
      }>;
      created_at: string;
    };
  }> {
    const items = Array.isArray(params.items) ? params.items : [];
    if (items.length < 2) {
      throw new BadRequestException(
        'At least 2 sound effects are required to merge',
      );
    }

    const ids = items
      .map((item) => String(item.sound_effect_id ?? '').trim())
      .filter(Boolean);
    if (ids.length < 2) {
      throw new BadRequestException('Invalid sound effect ids');
    }

    const effects = await this.repo.find({
      where: ids.map((id) => ({ id, user_id: params.user_id })) as any,
    });

    if (effects.length !== ids.length) {
      throw new NotFoundException('One or more sound effects were not found');
    }

    const ordered = ids
      .map((id) => effects.find((effect) => effect.id === id)!)
      .filter(Boolean);

    const tmpDir = path.join(
      os.tmpdir(),
      `auto-video-sfx-merge-${randomUUID()}`,
    );
    fs.mkdirSync(tmpDir, { recursive: true });

    const cleanupPaths: string[] = [tmpDir];
    const inputPaths: string[] = [];

    try {
      for (let idx = 0; idx < ordered.length; idx += 1) {
        const effect = ordered[idx];
        const downloaded = await downloadUrlToBuffer({
          url: effect.url,
          maxBytes: 25 * 1024 * 1024,
          label: `sound effect ${idx + 1}`,
        });

        const ext =
          this.inferExtFromMime(downloaded.mimeType ?? '') ||
          path.extname(effect.url.split('?')[0] || '').toLowerCase() ||
          '.mp3';

        const inputPath = path.join(
          tmpDir,
          `input-${String(idx + 1).padStart(2, '0')}${ext}`,
        );
        fs.writeFileSync(inputPath, downloaded.buffer);
        inputPaths.push(inputPath);
      }

      const resolvedItems = items.map((item, index) =>
        resolveMergeSoundEffectRenderItem({
          item,
          sourceDefaults: {
            volumePercent: ordered[index]?.volume_percent,
            audioSettings: ordered[index]?.audio_settings,
          },
        }),
      );

      const { filterComplex, outLabel } = this.buildFilterGraph({
        inputCount: inputPaths.length,
        items: resolvedItems,
      });

      const outMp3 = path.join(tmpDir, 'merged.mp3');
      const outWav = path.join(tmpDir, 'merged.wav');

      const baseArgs = [
        '-y',
        ...inputPaths.flatMap((inputPath) => ['-i', inputPath]),
        '-filter_complex',
        filterComplex,
        '-map',
        `[${outLabel}]`,
      ];

      try {
        await this.callFfmpeg([
          ...baseArgs,
          '-vn',
          '-ar',
          '44100',
          '-ac',
          '2',
          '-c:a',
          'libmp3lame',
          '-q:a',
          '4',
          outMp3,
        ]);
      } catch {
        await this.callFfmpeg([
          ...baseArgs,
          '-vn',
          '-ar',
          '44100',
          '-ac',
          '2',
          '-c:a',
          'pcm_s16le',
          outWav,
        ]);
      }

      const outPath = fs.existsSync(outMp3) ? outMp3 : outWav;
      const mergedBuffer = fs.readFileSync(outPath);
      const mergedDurationSeconds =
        await this.getAudioDurationSecondsFromFile(outPath);

      return {
        mergedBuffer,
        mergedFilename: path.basename(outPath),
        mergedDurationSeconds,
        mergedFrom: {
          items: resolvedItems.map((item) => item.mergedFromItem),
          created_at: new Date().toISOString(),
        },
      };
    } finally {
      for (const cleanupPath of cleanupPaths) {
        try {
          if (fs.existsSync(cleanupPath)) {
            fs.rmSync(cleanupPath, { recursive: true, force: true });
          }
        } catch {
          // ignore
        }
      }
    }
  }

  async mergePreview(params: {
    user_id: string;
    title?: string;
    items: MergeSoundEffectItemDto[];
  }): Promise<{
    title: string;
    url: string;
    volume_percent: number;
    duration_seconds: number | null;
    audio_settings: Record<string, unknown>;
  }> {
    const rendered = await this.renderMergedAudio({
      user_id: params.user_id,
      items: params.items,
    });
    const uploaded = await this.uploadAudioToManagedStorage({
      buffer: rendered.mergedBuffer,
      filename: rendered.mergedFilename,
    });

    return {
      title: String(params.title ?? '').trim() || 'Merged sound preview',
      url: uploaded.url,
      volume_percent: 100,
      duration_seconds: rendered.mergedDurationSeconds,
      audio_settings: DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS,
    };
  }

  async mergeAndCreate(params: {
    user_id: string;
    title?: string;
    volumePercent?: number;
    audioSettings?: Record<string, unknown> | null;
    isPreset?: boolean;
    requireUniqueTitle?: boolean;
    items: MergeSoundEffectItemDto[];
  }): Promise<SoundEffect> {
    const title = String(params.title ?? '').trim() || 'Merged sound';
    if (params.requireUniqueTitle === true) {
      await this.assertTitleAvailable({
        user_id: params.user_id,
        name: title,
      });
    }

    const rendered = await this.renderMergedAudio({
      user_id: params.user_id,
      items: params.items,
    });
    const uploaded = await this.uploadAudioToManagedStorage({
      buffer: rendered.mergedBuffer,
      filename: rendered.mergedFilename,
    });

    const rawVolume = Number(params.volumePercent);
    const volumePercent = Number.isFinite(rawVolume)
      ? clampPercent(rawVolume)
      : 100;

    const mergedEntity = this.repo.create({
      user_id: params.user_id,
      title,
      name: title,
      url: uploaded.url,
      public_id: uploaded.public_id,
      hash: crypto
        .createHash('sha256')
        .update(rendered.mergedBuffer)
        .digest('hex'),
      number_of_times_used: 0,
      volume_percent: volumePercent,
      duration_seconds: rendered.mergedDurationSeconds,
      audio_settings: normalizeSoundEffectAudioSettings(
        params.audioSettings ?? DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS,
      ),
      fromFavorites: false,
      is_merged: true,
      is_preset: params.isPreset === true,
      merged_from: rendered.mergedFrom,
    });

    return this.normalizeStoredSoundEffect(await this.repo.save(mergedEntity));
  }
}
