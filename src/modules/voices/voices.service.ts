import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v2 as cloudinary } from 'cloudinary';
import { Voice } from './entities/voice.entity';
import { CreateVoiceDto } from './dto/create-voice.dto';
import { UpdateVoiceDto } from './dto/update-voice.dto';
import * as crypto from 'crypto';

@Injectable()
export class VoicesService {
  constructor(
    @InjectRepository(Voice)
    private readonly voicesRepository: Repository<Voice>,
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

  async create(createVoiceDto: CreateVoiceDto): Promise<Voice> {
    const voice = this.voicesRepository.create(createVoiceDto);
    return this.voicesRepository.save(voice);
  }

  async findAllByUser(
    user_id: string,
    page = 1,
    limit = 20,
  ): Promise<{ items: Voice[]; total: number; page: number; limit: number }> {
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit =
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 50) : 20;

    const [items, total] = await this.voicesRepository.findAndCount({
      where: { user_id },
      order: { created_at: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

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
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_CLOUD_SECRET
    ) {
      throw new InternalServerErrorException(
        'Cloudinary environment variables are not configured',
      );
    }

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

      const uploadResult: any = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'auto-video-generator/voices',
            resource_type: 'video', // audio files are stored under the "video" type in Cloudinary
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

      const voicePartial: Partial<Voice> = {
        voice: uploadResult.secure_url,
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
