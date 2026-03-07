import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { v2 as cloudinary } from 'cloudinary';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { SoundEffect } from './entities/sound-effect.entity';
import { downloadUrlToBuffer } from '../render-videos/utils/net.utils';
import type { MergeSoundEffectItemDto } from './dto/merge-sound-effects.dto';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const clampPercent = (v: number) => Math.max(0, Math.min(300, v));

@Injectable()
export class SoundEffectsService {
  constructor(
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
      order: { created_at: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    // Backfill name in-memory for rows created before `name` existed.
    const normalized = items.map((it: any) => {
      const name =
        String(it?.name ?? '').trim() ||
        String(it?.title ?? '').trim() ||
        'Sound Effect';
      return { ...it, name };
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
      order: { created_at: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    const normalized = items.map((it: any) => {
      const name =
        String(it?.name ?? '').trim() ||
        String(it?.title ?? '').trim() ||
        'Sound Effect';
      return { ...it, name };
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
  }): Promise<SoundEffect> {
    const soundEffectId = String(params.soundEffectId ?? '').trim();
    if (!soundEffectId) throw new NotFoundException('Sound effect not found');

    const target = await this.repo.findOne({
      where: { id: soundEffectId, user_id: params.user_id },
    });

    if (!target) throw new NotFoundException('Sound effect not found');

    target.is_transition_sound = Boolean(params.isTransitionSound);
    return this.repo.save(target);
  }

  async renameById(params: {
    user_id: string;
    soundEffectId: string;
    name: string;
  }): Promise<SoundEffect> {
    const soundEffectId = String(params.soundEffectId ?? '').trim();
    if (!soundEffectId) throw new NotFoundException('Sound effect not found');

    const name = String(params.name ?? '').trim();
    if (!name) throw new BadRequestException('Name is required');

    const target = await this.repo.findOne({
      where: { id: soundEffectId, user_id: params.user_id },
    });

    if (!target) throw new NotFoundException('Sound effect not found');

    (target as any).name = name;
    // Keep title in sync for older clients.
    target.title = name;
    return this.repo.save(target);
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
      // Keep title in sync for older clients.
      const title = String(params.title ?? '').trim() || name;

      if (existing) {
        existing.number_of_times_used += 1;
        if (title) existing.title = title;
        if (name) (existing as any).name = name;
        return this.repo.save(existing);
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
        volume_percent: 100,
      });

      return this.repo.save(entity);
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
    items: Array<{ delayMs: number; volume: number }>;
  }): { filterComplex: string; outLabel: string } {
    const parts: string[] = [];
    const outLabels: string[] = [];

    for (let i = 0; i < params.inputCount; i += 1) {
      const delayMs = Math.max(0, Math.round(params.items[i]?.delayMs ?? 0));
      const volume = clamp01(params.items[i]?.volume ?? 1);
      const out = `a${i}`;
      // aresample makes amix happier when inputs differ.
      parts.push(
        `[${i}:a]adelay=${delayMs}:all=1,volume=${volume.toFixed(6)},aresample=async=1[${out}]`,
      );
      outLabels.push(`[${out}]`);
    }

    const mixLabel = 'mix';
    parts.push(
      `${outLabels.join('')}amix=inputs=${params.inputCount}:normalize=0[${mixLabel}]`,
    );

    return { filterComplex: parts.join(';'), outLabel: mixLabel };
  }

  async mergeAndCreate(params: {
    user_id: string;
    title?: string;
    items: MergeSoundEffectItemDto[];
  }): Promise<SoundEffect> {
    const items = Array.isArray(params.items) ? params.items : [];
    if (items.length < 2) {
      throw new BadRequestException(
        'At least 2 sound effects are required to merge',
      );
    }

    const ids = items
      .map((i) => String(i.sound_effect_id ?? '').trim())
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

    // Maintain order as provided.
    const ordered = ids
      .map((id) => effects.find((e) => e.id === id)!)
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

      const mapped = items.map((it) => {
        const delaySeconds = Number(it.delay_seconds ?? 0);
        const volumePercent = Number(it.volume_percent ?? 100);
        return {
          delayMs: Number.isFinite(delaySeconds)
            ? Math.max(0, Math.round(delaySeconds * 1000))
            : 0,
          volume: Number.isFinite(volumePercent)
            ? clamp01(clampPercent(volumePercent) / 100)
            : 1,
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
        ...inputPaths.flatMap((p) => ['-i', p]),
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

      const uploaded = await this.uploadAudioToCloudinary({
        buffer: mergedBuffer,
      });

      const title = String(params.title ?? '').trim() || 'Merged sound';
      const name = title;

      const mergedEntity = this.repo.create({
        user_id: params.user_id,
        title,
        name,
        url: uploaded.url,
        public_id: uploaded.public_id,
        hash: crypto.createHash('sha256').update(mergedBuffer).digest('hex'),
        number_of_times_used: 0,
        volume_percent: 100,
        is_merged: true,
        merged_from: {
          items: items.map((i) => ({
            sound_effect_id: i.sound_effect_id,
            delay_seconds: i.delay_seconds ?? 0,
            volume_percent: i.volume_percent ?? 100,
          })),
          created_at: new Date().toISOString(),
        },
      });

      return await this.repo.save(mergedEntity);
    } finally {
      // Best-effort cleanup.
      for (const p of cleanupPaths) {
        try {
          if (fs.existsSync(p)) {
            fs.rmSync(p, { recursive: true, force: true });
          }
        } catch {
          // ignore
        }
      }
    }
  }
}
