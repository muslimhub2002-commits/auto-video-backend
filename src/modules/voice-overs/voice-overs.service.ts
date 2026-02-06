import {
  Injectable,
  Logger,
  InternalServerErrorException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { VoiceOver } from './entities/voice-over.entity';
import { AiService } from '../ai/ai.service';
import { v2 as cloudinary } from 'cloudinary';

type VoiceProvider = 'elevenlabs' | 'google';

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

type GeminiPrebuiltVoice = {
  name: string;
  style?: string;
};

@Injectable()
export class VoiceOversService {
  private readonly logger = new Logger(VoiceOversService.name);

  // Gemini TTS (AI Studio) prebuilt voices.
  // Source: https://ai.google.dev/gemini-api/docs/speech-generation#voice_options
  private readonly geminiPrebuiltVoices: GeminiPrebuiltVoice[] = [
    { name: 'Zephyr', style: 'Bright' },
    { name: 'Puck', style: 'Upbeat' },
    { name: 'Charon', style: 'Informative' },
    { name: 'Kore', style: 'Firm' },
    { name: 'Fenrir', style: 'Excitable' },
    { name: 'Leda', style: 'Youthful' },
    { name: 'Orus', style: 'Firm' },
    { name: 'Aoede', style: 'Breezy' },
    { name: 'Callirrhoe', style: 'Easy-going' },
    { name: 'Autonoe', style: 'Bright' },
    { name: 'Enceladus', style: 'Breathy' },
    { name: 'Iapetus', style: 'Clear' },
    { name: 'Umbriel', style: 'Easy-going' },
    { name: 'Algieba', style: 'Smooth' },
    { name: 'Despina', style: 'Smooth' },
    { name: 'Erinome', style: 'Clear' },
    { name: 'Algenib', style: 'Gravelly' },
    { name: 'Rasalgethi', style: 'Informative' },
    { name: 'Laomedeia', style: 'Upbeat' },
    { name: 'Achernar', style: 'Soft' },
    { name: 'Alnilam', style: 'Firm' },
    { name: 'Schedar', style: 'Even' },
    { name: 'Gacrux', style: 'Mature' },
    { name: 'Pulcherrima', style: 'Forward' },
    { name: 'Achird', style: 'Friendly' },
    { name: 'Zubenelgenubi', style: 'Casual' },
    { name: 'Vindemiatrix', style: 'Gentle' },
    { name: 'Sadachbia', style: 'Lively' },
    { name: 'Sadaltager', style: 'Knowledgeable' },
    { name: 'Sulafat', style: 'Warm' },
  ];

  constructor(
    @InjectRepository(VoiceOver)
    private readonly voiceOverRepository: Repository<VoiceOver>,
    private readonly aiService: AiService,
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

  private async uploadAudioPreviewToCloudinary(params: {
    buffer: Buffer;
    fileName: string;
    folder: string;
    overwrite?: boolean;
  }): Promise<string> {
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_CLOUD_SECRET
    ) {
      throw new InternalServerErrorException(
        'Cloudinary environment variables are not configured',
      );
    }

    const { buffer, fileName, folder, overwrite = false } = params;

    return await new Promise<string>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'video',
          folder,
          public_id: fileName,
          format: 'mp3',
          overwrite,
        },
        (error, result) => {
          if (error) return reject(error);
          if (!result?.secure_url) {
            return reject(
              new Error('Cloudinary upload failed: missing secure_url'),
            );
          }
          resolve(result.secure_url);
        },
      );

      uploadStream.end(buffer);
    });
  }

  async getOrCreatePreviewUrl(voiceId: string): Promise<{ preview_url: string }> {
    const raw = String(voiceId ?? '').trim();
    const candidates = raw.includes(':') ? [raw] : [raw, `google:${raw}`];

    const voice = await this.voiceOverRepository.findOne({
      where: { voice_id: In(candidates) },
    });

    if (!voice) {
      throw new NotFoundException(`Voice not found: ${raw}`);
    }

    if (voice.preview_url) {
      return { preview_url: voice.preview_url };
    }

    if (voice.provider !== 'google') {
      throw new BadRequestException(
        `Preview generation is only supported for AI Studio voices. Voice provider is: ${voice.provider}`,
      );
    }

    const previewText =
      'Hi! This is a quick preview of my voice. If you like it, you can use me to generate your voice-over.';

    const { buffer } = await this.aiService.generateVoiceForScript(
      previewText,
      voice.voice_id,
    );

    const safePublicId = String(voice.voice_id)
      .replace(/[:/\\\s]+/g, '__')
      .replace(/[^a-zA-Z0-9_\-]/g, '');

    const previewUrl = await this.uploadAudioPreviewToCloudinary({
      buffer,
      fileName: `${safePublicId}__preview`,
      folder: 'auto-video-generator/voice-previews',
      overwrite: false,
    });

    await this.voiceOverRepository.update(
      { id: voice.id },
      { preview_url: previewUrl },
    );

    return { preview_url: previewUrl };
  }

  private normalizeProvider(provider?: string): VoiceProvider {
    const value = String(provider ?? '')
      .trim()
      .toLowerCase();
    if (value === 'elevenlabs') return 'elevenlabs';
    if (value === 'google' || value === 'ai-studio' || value === 'aistudio') {
      return 'google';
    }
    // Default to AI Studio as requested
    return 'google';
  }

  private namespacedVoiceId(provider: VoiceProvider, rawId: string): string {
    const trimmed = String(rawId ?? '').trim();
    if (!trimmed) return trimmed;
    if (trimmed.includes(':')) return trimmed;
    return `${provider}:${trimmed}`;
  }

  private stripNamespace(provider: VoiceProvider, voiceId: string): string {
    const prefix = `${provider}:`;
    return voiceId.startsWith(prefix) ? voiceId.slice(prefix.length) : voiceId;
  }

  private async ensureNamespacedForProvider(provider: VoiceProvider): Promise<void> {
    const prefix = `${provider}:`;
    const rows = await this.voiceOverRepository.find({ where: { provider } });

    for (const row of rows) {
      const id = String(row.voice_id ?? '').trim();
      if (!id) continue;
      if (id.includes(':')) continue;
      try {
        await this.voiceOverRepository.update(
          { id: row.id },
          { voice_id: `${prefix}${id}` },
        );
      } catch (error) {
        this.logger.warn(
          `Failed to namespace voice_id for row ${row.id} (${provider})`,
        );
      }
    }
  }

  private async ensureSeeded(provider: VoiceProvider): Promise<void> {
    await this.ensureNamespacedForProvider(provider);

    const count = await this.voiceOverRepository.count({ where: { provider } });
    if (count > 0) {
      // Keep Google/AI Studio catalog aligned to the prebuilt Gemini voice list.
      if (provider === 'google' && count !== this.geminiPrebuiltVoices.length) {
        await this.syncAllFromGoogleTts();
      }
      return;
    }

    // If table is empty for this provider, pull the catalog once.
    if (provider === 'elevenlabs') {
      await this.syncAllFromElevenLabs();
      return;
    }

    if (provider === 'google') {
      await this.syncAllFromGoogleTts();
      return;
    }
  }

  async syncAll(params?: {
    provider?: string;
  }): Promise<{ imported: number; updated: number }> {
    const provider = this.normalizeProvider(params?.provider);
    if (provider === 'elevenlabs') return this.syncAllFromElevenLabs();
    return this.syncAllFromGoogleTts();
  }

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
      const provider: VoiceProvider = 'elevenlabs';
      const rawId = String(voice.voice_id ?? '').trim();
      if (!rawId) continue;
      const nextVoiceId = this.namespacedVoiceId(provider, rawId);

      const existing = await this.voiceOverRepository.findOne({
        where: [{ voice_id: nextVoiceId }, { voice_id: rawId }],
      });

      const labels = voice.labels || {};

      const payload: Partial<VoiceOver> = {
        provider,
        voice_id: nextVoiceId,
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
        // Normalize legacy, non-namespaced IDs in-place.
        if (!String(existing.voice_id ?? '').includes(':')) {
          payload.voice_id = nextVoiceId;
        }
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

  async syncAllFromGoogleTts(): Promise<{ imported: number; updated: number }> {
    let imported = 0;
    let updated = 0;

    const provider: VoiceProvider = 'google';
    const allowedVoiceIds = this.geminiPrebuiltVoices
      .map((v) => this.namespacedVoiceId(provider, v.name))
      .filter(Boolean);

    for (const voice of this.geminiPrebuiltVoices) {
      const rawId = String(voice.name ?? '').trim();
      if (!rawId) continue;
      const nextVoiceId = this.namespacedVoiceId(provider, rawId);

      const existing = await this.voiceOverRepository.findOne({
        where: [{ voice_id: nextVoiceId }, { voice_id: rawId }],
      });

      const payload: Partial<VoiceOver> = {
        provider,
        voice_id: nextVoiceId,
        name: rawId,
        // Preserve any cached Cloudinary preview URL we may have generated.
        preview_url: existing?.preview_url ?? null,
        description: null,
        category: 'gemini-tts',
        gender: null,
        accent: null,
        descriptive: null,
        use_case: voice.style ?? 'AI Studio',
      };

      if (existing) {
        if (!String(existing.voice_id ?? '').includes(':')) {
          payload.voice_id = nextVoiceId;
        }
        await this.voiceOverRepository.update({ id: existing.id }, payload);
        updated += 1;
      } else {
        await this.voiceOverRepository.save(
          this.voiceOverRepository.create(payload),
        );
        imported += 1;
      }
    }

    // Remove any old/unsupported Google voices (e.g., from previous Cloud TTS sync).
    // This keeps the UI aligned with AI Studio's prebuilt voice library.
    if (allowedVoiceIds.length > 0) {
      await this.voiceOverRepository.delete({
        provider,
        voice_id: Not(In(allowedVoiceIds)),
      });
    }

    return { imported, updated };
  }

  async findAll(params?: { provider?: string }): Promise<VoiceOver[]> {
    const provider = this.normalizeProvider(params?.provider);
    await this.ensureSeeded(provider);

    return this.voiceOverRepository.find({
      where: { provider },
      order: {
        isFavorite: 'DESC',
        name: 'ASC',
      },
    });
  }

  async setFavoriteByVoiceId(voiceId: string): Promise<VoiceOver> {
    const id = String(voiceId ?? '').trim();
    const candidates = [
      id,
      this.namespacedVoiceId('google', id),
      this.namespacedVoiceId('elevenlabs', id),
    ].filter(Boolean);

    const target = await this.voiceOverRepository.findOne({
      where: candidates.map((voice_id) => ({ voice_id })),
    });

    if (!target) {
      throw new NotFoundException('Voice not found');
    }

    await this.voiceOverRepository.manager.transaction(async (manager) => {
      const repo = manager.getRepository(VoiceOver);

      // Use TypeORM metadata-aware updates so column naming/quoting works in Postgres
      await repo.update(
        { provider: target.provider, isFavorite: true },
        { isFavorite: false },
      );
      await repo.update({ voice_id: target.voice_id }, { isFavorite: true });
    });

    const updated = await this.voiceOverRepository.findOne({
      where: { voice_id: target.voice_id },
    });

    if (!updated) {
      throw new NotFoundException('Voice not found after update');
    }

    return updated;
  }
}
