import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, Repository } from 'typeorm';
import { v2 as cloudinary } from 'cloudinary';
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
} from './audio-settings.types';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const clampPercent = (v: number) => Math.max(0, Math.min(300, v));

@Injectable()
export class SoundEffectsService implements OnModuleInit {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(SoundEffect)
    private readonly repo: Repository<SoundEffect>,
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

  async onModuleInit() {
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
    target.fromFavorites = !Boolean(target.fromFavorites);
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
        if (
          process.env.CLOUDINARY_CLOUD_NAME &&
          process.env.CLOUDINARY_API_KEY &&
          process.env.CLOUDINARY_CLOUD_SECRET
        ) {
          await cloudinary.uploader.destroy(publicId, {
            resource_type: 'video',
          } as any);
        }
      } catch (error) {
        console.error('Failed to delete sound effect from Cloudinary', {
          soundEffectId,
          publicId,
          error,
        });
      }
    }

    await this.repo.delete({ id: target.id, user_id: params.user_id } as any);
    return target.id;
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
  }): Promise<{ url: string; public_id: string | null }> {
    this.ensureCloudinaryConfigured();

    const uploadResult: any = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'auto-video-generator/sound-effects',
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

      const uploaded = await this.uploadAudioToCloudinary({
        buffer: params.buffer,
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
    items: Array<{
      delayMs: number;
      volume: number;
      trimStartSeconds: number;
      trimDurationSeconds: number | null;
    }>;
  }): { filterComplex: string; outLabel: string } {
    const parts: string[] = [];
    const outLabels: string[] = [];

    for (let i = 0; i < params.inputCount; i += 1) {
      const delayMs = Math.max(0, Math.round(params.items[i]?.delayMs ?? 0));
      const volume = clamp01(params.items[i]?.volume ?? 1);
      const trimStartSeconds = Math.max(
        0,
        Number(params.items[i]?.trimStartSeconds ?? 0) || 0,
      );
      const rawTrimDurationSeconds = params.items[i]?.trimDurationSeconds;
      const trimDurationSeconds =
        typeof rawTrimDurationSeconds === 'number' &&
        Number.isFinite(rawTrimDurationSeconds)
          ? Math.max(0, rawTrimDurationSeconds)
          : null;
      const out = `a${i}`;
      const filters: string[] = [];

      if (
        trimStartSeconds > 0 ||
        (trimDurationSeconds !== null && trimDurationSeconds > 0)
      ) {
        const trimArgs: string[] = [];
        if (trimStartSeconds > 0) {
          trimArgs.push(`start=${trimStartSeconds.toFixed(6)}`);
        }
        if (trimDurationSeconds !== null && trimDurationSeconds > 0) {
          trimArgs.push(`duration=${trimDurationSeconds.toFixed(6)}`);
        }
        if (trimArgs.length > 0) {
          filters.push(`atrim=${trimArgs.join(':')}`);
          filters.push('asetpts=PTS-STARTPTS');
        }
      }

      // aresample makes amix happier when inputs differ.
      filters.push(`adelay=${delayMs}:all=1`);
      filters.push(`volume=${volume.toFixed(6)}`);
      filters.push('aresample=async=1');
      parts.push(`[${i}:a]${filters.join(',')}[${out}]`);
      outLabels.push(`[${out}]`);
    }

    const mixLabel = 'mix';
    parts.push(
      `${outLabels.join('')}amix=inputs=${params.inputCount}:normalize=0[${mixLabel}]`,
    );

    return { filterComplex: parts.join(';'), outLabel: mixLabel };
  }

  private async renderMergedAudio(params: {
    user_id: string;
    items: MergeSoundEffectItemDto[];
  }): Promise<{
    mergedBuffer: Buffer;
    mergedDurationSeconds: number | null;
    mergedFrom: {
      items: Array<{
        sound_effect_id: string;
        delay_seconds: number;
        volume_percent: number;
        trim_start_seconds: number;
        duration_seconds: number | null;
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

      const mapped = items.map((item) => {
        const delaySeconds = Number(item.delay_seconds ?? 0);
        const volumePercent = Number(item.volume_percent ?? 100);
        const trimStartSeconds = Number(item.trim_start_seconds ?? 0);
        const rawDurationSeconds = Number(item.duration_seconds);
        return {
          delayMs: Number.isFinite(delaySeconds)
            ? Math.max(0, Math.round(delaySeconds * 1000))
            : 0,
          volume: Number.isFinite(volumePercent)
            ? clamp01(clampPercent(volumePercent) / 100)
            : 1,
          trimStartSeconds: Number.isFinite(trimStartSeconds)
            ? Math.max(0, trimStartSeconds)
            : 0,
          trimDurationSeconds: Number.isFinite(rawDurationSeconds)
            ? Math.max(0, rawDurationSeconds)
            : null,
        };
      });

      const { filterComplex, outLabel } = this.buildFilterGraph({
        inputCount: inputPaths.length,
        items: mapped,
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
        mergedDurationSeconds,
        mergedFrom: {
          items: items.map((item) => ({
            sound_effect_id: item.sound_effect_id,
            delay_seconds: item.delay_seconds ?? 0,
            volume_percent: item.volume_percent ?? 100,
            trim_start_seconds: item.trim_start_seconds ?? 0,
            duration_seconds:
              typeof item.duration_seconds === 'number' &&
              Number.isFinite(item.duration_seconds)
                ? Math.max(0, item.duration_seconds)
                : null,
          })),
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
    const uploaded = await this.uploadAudioToCloudinary({
      buffer: rendered.mergedBuffer,
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
    const uploaded = await this.uploadAudioToCloudinary({
      buffer: rendered.mergedBuffer,
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
