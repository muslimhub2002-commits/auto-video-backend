import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VoiceOver } from './entities/voice-over.entity';

interface ElevenLabsVoiceSample {
  sample_id: string;
  file_size_bytes: number;
  mime_type: string;
  hash: string;
}

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  description?: string;
  gender?: string;
  accent?: string;
  labels?: Record<string, string>;
  preview_url?: string;
  samples?: ElevenLabsVoiceSample[];
}

interface ElevenLabsVoicesResponse {
  voices: ElevenLabsVoice[];
  next_page_token?: string | null;
}

@Injectable()
export class VoiceOversService {
  private readonly logger = new Logger(VoiceOversService.name);

  constructor(
    @InjectRepository(VoiceOver)
    private readonly voiceOverRepository: Repository<VoiceOver>,
  ) {}

  async syncAllFromElevenLabs(): Promise<{
    imported: number;
    updated: number;
  }> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      this.logger.error('ELEVENLABS_API_KEY is not set');
      throw new Error('ELEVENLABS_API_KEY is not configured');
    }

    let imported = 0;
    let updated = 0;
    let pageToken: string | null | undefined = undefined;

    // Loop through all pages if pagination is present
    // ElevenLabs currently returns a list; this is future-proof if they add pagination.
    const url = new URL('https://api.elevenlabs.io/v1/voices');
    if (pageToken) {
      url.searchParams.set('page_token', pageToken);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      const text = await response.text();
      this.logger.error(
        `Failed to fetch ElevenLabs voices: ${response.status} ${response.statusText} - ${text}`,
      );
      throw new Error('Failed to fetch ElevenLabs voices');
    }

    const data = (await response.json()) as ElevenLabsVoicesResponse;
    const voices = data.voices || [];
    for (const voice of voices) {
      const existing = await this.voiceOverRepository.findOne({
        where: { voice_id: voice.voice_id },
      });

      const labels = voice.labels || {};

      const payload: Partial<VoiceOver> = {
        voice_id: voice.voice_id,
        name: voice.name,
        preview_url: voice.preview_url ?? null,
        description: voice.description ?? null,
        category: voice.category ?? null,
        gender: voice.gender ?? labels.gender ?? null,
        accent: voice.accent ?? labels.accent ?? null,
        descriptive: labels.descriptive ?? null,
        use_case: labels.use_case ?? null,
      };

      if (existing) {
        await this.voiceOverRepository.update({ id: existing.id }, payload);
        updated += 1;
      } else {
        await this.voiceOverRepository.save(
          this.voiceOverRepository.create(payload),
        );
        imported += 1;
      }
    }

    pageToken = data.next_page_token ?? null;

    return { imported, updated };
  }

  async findAll(): Promise<VoiceOver[]> {
    return this.voiceOverRepository.find({
      order: {
        isFavorite: 'DESC',
        name: 'ASC',
      },
    });
  }

  async setFavoriteByVoiceId(voiceId: string): Promise<VoiceOver> {
    const target = await this.voiceOverRepository.findOne({
      where: { voice_id: voiceId },
    });

    if (!target) {
      throw new NotFoundException('Voice not found');
    }

    await this.voiceOverRepository.manager.transaction(async (manager) => {
      await manager
        .createQueryBuilder()
        .update(VoiceOver)
        .set({ isFavorite: false })
        .where('isFavorite = :isFavorite', { isFavorite: true })
        .execute();

      await manager
        .createQueryBuilder()
        .update(VoiceOver)
        .set({ isFavorite: true })
        .where('voice_id = :voiceId', { voiceId })
        .execute();
    });

    const updated = await this.voiceOverRepository.findOne({
      where: { voice_id: voiceId },
    });

    if (!updated) {
      throw new NotFoundException('Voice not found after update');
    }

    return updated;
  }
}
