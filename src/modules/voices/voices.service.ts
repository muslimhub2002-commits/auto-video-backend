import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Voice } from './entities/voice.entity';
import { CreateVoiceDto } from './dto/create-voice.dto';
import { UpdateVoiceDto } from './dto/update-voice.dto';
import * as crypto from 'crypto';
import { UploadsService } from '../uploads/uploads.service';

@Injectable()
export class VoicesService {
  constructor(
    @InjectRepository(Voice)
    private readonly voicesRepository: Repository<Voice>,
    private readonly uploadsService: UploadsService,
  ) {}

  async create(createVoiceDto: CreateVoiceDto): Promise<Voice> {
    const voice = this.voicesRepository.create(createVoiceDto);
    return this.voicesRepository.save(voice);
  }

  async createFromUrl(params: {
    voiceUrl: string;
    user_id: string;
    voice_type?: string;
    voice_lang?: string;
    hash?: string;
  }): Promise<Voice> {
    const existing = await this.voicesRepository.findOne({
      where: params.hash
        ? { user_id: params.user_id, hash: params.hash }
        : { user_id: params.user_id, voice: params.voiceUrl },
    });

    if (existing) {
      existing.number_of_times_used += 1;
      if (params.voice_type) existing.voice_type = params.voice_type;
      if (params.voice_lang) existing.voice_lang = params.voice_lang;
      if (params.hash && !existing.hash) existing.hash = params.hash;
      return this.voicesRepository.save(existing);
    }

    const voiceEntity = this.voicesRepository.create({
      voice: params.voiceUrl,
      user_id: params.user_id,
      voice_type: params.voice_type,
      voice_lang: params.voice_lang,
      hash: params.hash ?? null,
      number_of_times_used: 0,
    });

    return this.voicesRepository.save(voiceEntity);
  }

  async findAllByUser(
    user_id: string,
    page = 1,
    limit = 20,
  ): Promise<{ items: Voice[]; total: number; page: number; limit: number }> {
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit =
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 50) : 20;

    const cloudinaryDeliveryAvailable =
      await this.uploadsService.isCloudinaryDeliveryAvailable();

    const query = this.voicesRepository
      .createQueryBuilder('voice')
      .where('voice.user_id = :user_id', { user_id });

    if (!cloudinaryDeliveryAvailable) {
      query.andWhere(
        'voice.voice NOT LIKE :cloudinaryHttps AND voice.voice NOT LIKE :cloudinaryHttp',
        {
          cloudinaryHttps: 'https://res.cloudinary.com/%',
          cloudinaryHttp: 'http://res.cloudinary.com/%',
        },
      );
    }

    const [items, total] = await query
      .orderBy('voice.created_at', 'DESC')
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit)
      .getManyAndCount();

    return { items, total, page: safePage, limit: safeLimit };
  }

  async update(id: string, updateVoiceDto: UpdateVoiceDto): Promise<Voice> {
    await this.voicesRepository.update(id, updateVoiceDto);
    const updated = await this.voicesRepository.findOne({ where: { id } });
    if (!updated) {
      throw new InternalServerErrorException('Voice not found after update');
    }
    return updated;
  }

  async saveToCloudinary(params: {
    buffer: Buffer;
    filename: string;
    user_id: string;
    voice_type?: string;
    voice_lang?: string;
  }): Promise<Voice> {
    try {
      // Compute a content hash of the audio buffer to detect duplicates
      const hash = crypto
        .createHash('sha256')
        .update(params.buffer)
        .digest('hex');

      // If a voice with the same hash already exists for this user,
      // reuse it instead of uploading a duplicate and creating a new row.
      const existing = await this.voicesRepository.findOne({
        where: {
          user_id: params.user_id,
          hash,
        },
      });

      if (existing) {
        existing.number_of_times_used += 1;
        // Optionally update metadata if provided
        if (params.voice_type) existing.voice_type = params.voice_type;
        if (params.voice_lang) existing.voice_lang = params.voice_lang;
        return this.voicesRepository.save(existing);
      }

      const uploadResult = await this.uploadsService.uploadBuffer({
        buffer: params.buffer,
        filename: params.filename,
        mimeType: 'audio/mpeg',
        folder: 'auto-video-generator/voices',
        resourceType: 'audio',
      });

      const voicePartial: Partial<Voice> = {
        voice: uploadResult.url,
        user_id: params.user_id,
        number_of_times_used: 0,
        voice_type: params.voice_type,
        voice_lang: params.voice_lang,
        hash,
      };

      const voiceEntity = this.voicesRepository.create(voicePartial);
      return await this.voicesRepository.save(voiceEntity);
    } catch (error: any) {
      console.error('Error in saveToCloudinary (voice):', error);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to upload voice-over',
      );
    }
  }
}
