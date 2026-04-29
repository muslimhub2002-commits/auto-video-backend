import {
  Injectable,
  Logger,
  OnModuleInit,
  InternalServerErrorException,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { sha256Hex, stableSerializeValue } from '../../common/utils/stable-hash.utils';
import { shouldRunStartupTasks } from '../../common/runtime/runtime.utils';
import { VoiceOver } from './entities/voice-over.entity';
import { AiService } from '../ai/ai.service';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { UploadsService } from '../uploads/uploads.service';

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

type VoiceOverPersistencePayload = {
  user_id: string;
  hash: string;
  provider: VoiceProvider;
  voice_id: string;
  name: string;
  preview_url: string | null;
  description: string | null;
  category: string | null;
  gender: string | null;
  accent: string | null;
  descriptive: string | null;
  use_case: string | null;
};

@Injectable()
export class VoiceOversService implements OnModuleInit {
  private readonly logger = new Logger(VoiceOversService.name);
  private schemaEnsuring: Promise<void> | null = null;
  private schemaEnsured = false;

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
    private readonly uploadsService: UploadsService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!shouldRunStartupTasks()) {
      return;
    }

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
          'ALTER TABLE voice_overs ADD COLUMN IF NOT EXISTS user_id UUID NULL',
        );
        await this.dataSource.query(
          'ALTER TABLE voice_overs ADD COLUMN IF NOT EXISTS hash VARCHAR(64) NULL',
        );
        await this.dataSource.query(
          'CREATE INDEX IF NOT EXISTS idx_voice_overs_user_provider ON voice_overs (user_id, provider)',
        );
        await this.dataSource.query(`
          DO $$
          DECLARE constraint_record RECORD;
          BEGIN
            FOR constraint_record IN
              SELECT con.conname
              FROM pg_constraint con
              JOIN pg_class rel ON rel.oid = con.conrelid
              JOIN unnest(con.conkey) WITH ORDINALITY AS cols(attnum, ordinality) ON TRUE
              JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = cols.attnum
              WHERE rel.relname = 'voice_overs'
                AND con.contype = 'u'
              GROUP BY con.conname, con.conrelid
              HAVING array_agg(att.attname ORDER BY cols.ordinality) = ARRAY['voice_id']
            LOOP
              EXECUTE format('ALTER TABLE voice_overs DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
            END LOOP;
          END
          $$;
        `);
        await this.dataSource.query(
          'CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_overs_user_voice_id_unique ON voice_overs (user_id, voice_id) WHERE user_id IS NOT NULL',
        );
      } catch (error: any) {
        const message = String(error?.message ?? '');
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

  private buildVoiceHash(params: {
    provider: VoiceProvider;
    voice_id: string;
    name: string;
    description?: string | null;
    category?: string | null;
    gender?: string | null;
    accent?: string | null;
    descriptive?: string | null;
    use_case?: string | null;
  }): string {
    return sha256Hex(
      stableSerializeValue({
        provider: params.provider,
        voice_id: params.voice_id,
        name: params.name,
        description: params.description ?? null,
        category: params.category ?? null,
        gender: params.gender ?? null,
        accent: params.accent ?? null,
        descriptive: params.descriptive ?? null,
        use_case: params.use_case ?? null,
      }),
    );
  }

  private buildVoicePayload(params: {
    user_id: string;
    provider: VoiceProvider;
    voice_id: string;
    name: string;
    preview_url?: string | null;
    description?: string | null;
    category?: string | null;
    gender?: string | null;
    accent?: string | null;
    descriptive?: string | null;
    use_case?: string | null;
  }): VoiceOverPersistencePayload {
    const payload = {
      user_id: params.user_id,
      provider: params.provider,
      voice_id: params.voice_id,
      name: String(params.name ?? '').trim() || params.voice_id,
      preview_url: params.preview_url ?? null,
      description: params.description ?? null,
      category: params.category ?? null,
      gender: params.gender ?? null,
      accent: params.accent ?? null,
      descriptive: params.descriptive ?? null,
      use_case: params.use_case ?? null,
    };

    return {
      ...payload,
      hash: this.buildVoiceHash({
      provider: payload.provider!,
      voice_id: payload.voice_id!,
      name: payload.name!,
      description: payload.description ?? null,
      category: payload.category ?? null,
      gender: payload.gender ?? null,
      accent: payload.accent ?? null,
      descriptive: payload.descriptive ?? null,
      use_case: payload.use_case ?? null,
      }),
    };
  }

  private async findVoiceByCandidates(params: {
    user_id: string | null;
    candidates: string[];
    provider?: VoiceProvider;
  }): Promise<VoiceOver | null> {
    const candidates = params.candidates
      .map((candidate) => String(candidate ?? '').trim())
      .filter(Boolean);
    if (candidates.length === 0) {
      return null;
    }

    return this.voiceOverRepository.findOne({
      where: candidates.map((voice_id) => ({
        user_id: (params.user_id === null ? IsNull() : params.user_id) as any,
        voice_id,
        ...(params.provider ? { provider: params.provider } : {}),
      })) as any,
    });
  }

  private async upsertUserVoice(params: {
    user_id: string;
    provider: VoiceProvider;
    rawId: string;
    name: string;
    preview_url?: string | null;
    description?: string | null;
    category?: string | null;
    gender?: string | null;
    accent?: string | null;
    descriptive?: string | null;
    use_case?: string | null;
  }): Promise<{
    row: VoiceOver;
    outcome: 'imported' | 'updated' | 'unchanged';
  }> {
    const normalizedRawId = String(params.rawId ?? '').trim();
    if (!normalizedRawId) {
      throw new BadRequestException('voiceId is required');
    }

    const nextVoiceId = this.namespacedVoiceId(params.provider, normalizedRawId);
    const candidates = [nextVoiceId, normalizedRawId].filter(Boolean);
    const existing = await this.findVoiceByCandidates({
      user_id: params.user_id,
      candidates,
      provider: params.provider,
    });
    const legacy = existing
      ? null
      : await this.findVoiceByCandidates({
          user_id: null,
          candidates,
          provider: params.provider,
        });

    const payload = this.buildVoicePayload({
      user_id: params.user_id,
      provider: params.provider,
      voice_id: nextVoiceId,
      name: params.name,
      preview_url:
        params.preview_url ?? existing?.preview_url ?? legacy?.preview_url ?? null,
      description: params.description ?? null,
      category: params.category ?? null,
      gender: params.gender ?? null,
      accent: params.accent ?? null,
      descriptive: params.descriptive ?? null,
      use_case: params.use_case ?? null,
    });

    if (existing) {
      const unchanged =
        existing.voice_id === payload.voice_id &&
        existing.hash === payload.hash &&
        (existing.preview_url ?? null) === (payload.preview_url ?? null);

      if (unchanged) {
        return { row: existing, outcome: 'unchanged' };
      }

      await this.voiceOverRepository.update({ id: existing.id }, payload);
      const updated = await this.voiceOverRepository.findOne({
        where: { id: existing.id },
      });
      if (!updated) {
        throw new InternalServerErrorException('Failed to update voice');
      }

      return { row: updated, outcome: 'updated' };
    }

    const created = await this.voiceOverRepository.save(
      this.voiceOverRepository.create({
        ...payload,
        isFavorite: false,
      }),
    );

    return { row: created, outcome: 'imported' };
  }

  private async ensureUserVoiceByCandidates(params: {
    user_id: string;
    candidates: string[];
    provider?: VoiceProvider;
  }): Promise<VoiceOver | null> {
    const existing = await this.findVoiceByCandidates({
      user_id: params.user_id,
      candidates: params.candidates,
      provider: params.provider,
    });

    if (existing) {
      return existing;
    }

    const legacy = await this.findVoiceByCandidates({
      user_id: null,
      candidates: params.candidates,
      provider: params.provider,
    });

    if (!legacy) {
      return null;
    }

    const materialized = await this.upsertUserVoice({
      user_id: params.user_id,
      provider: legacy.provider,
      rawId: this.stripNamespace(legacy.provider, legacy.voice_id),
      name: legacy.name,
      preview_url: legacy.preview_url ?? null,
      description: legacy.description ?? null,
      category: legacy.category ?? null,
      gender: legacy.gender ?? null,
      accent: legacy.accent ?? null,
      descriptive: legacy.descriptive ?? null,
      use_case: legacy.use_case ?? null,
    });

    return materialized.row;
  }

  private inferAudioMimeType(format?: string | null): string | undefined {
    const normalized = String(format ?? '')
      .trim()
      .toLowerCase();

    if (normalized === 'mp3') return 'audio/mpeg';
    if (normalized === 'wav') return 'audio/wav';
    if (normalized === 'aac') return 'audio/aac';
    if (normalized === 'ogg') return 'audio/ogg';
    if (normalized === 'webm') return 'audio/webm';
    if (normalized === 'm4a' || normalized === 'mp4') return 'audio/mp4';
    return undefined;
  }

  private async uploadAudioPreviewToManagedStorage(params: {
    buffer: Buffer;
    fileName: string;
    folder: string;
    format?: string;
  }): Promise<string> {
    const normalizedFormat = String(params.format ?? '')
      .trim()
      .toLowerCase();
    const filename = normalizedFormat
      ? `${params.fileName}.${normalizedFormat}`
      : params.fileName;

    const uploadResult = await this.uploadsService.uploadBuffer({
      buffer: params.buffer,
      filename,
      mimeType: this.inferAudioMimeType(normalizedFormat),
      folder: params.folder,
      resourceType: 'audio',
    });

    return uploadResult.url;
  }

  async getOrCreatePreviewUrl(
    user_id: string,
    voiceId: string,
  ): Promise<{ preview_url: string }> {
    await this.ensureSchema();

    const raw = String(voiceId ?? '').trim();
    const candidates = raw.includes(':')
      ? [raw]
      : [raw, `google:${raw}`, `elevenlabs:${raw}`];

    const voice = await this.ensureUserVoiceByCandidates({
      user_id,
      candidates,
    });

    if (!voice) {
      throw new NotFoundException(`Voice not found: ${raw}`);
    }

    if (voice.preview_url) {
      return { preview_url: voice.preview_url };
    }

    const previewText =
      'Hi! This is a quick preview of my voice. If you like it, you can use me to generate your voice-over.';

    const voiceResult = await this.aiService.generateVoiceForScript(
      previewText,
      voice.voice_id,
    );

    const safePublicId = String(voice.voice_id)
      .replace(/[:/\\\s]+/g, '__')
      .replace(/[^a-zA-Z0-9_\-]/g, '');

    const previewUrl = await this.uploadAudioPreviewToManagedStorage({
      buffer: voiceResult.buffer,
      fileName: `${safePublicId}__preview`,
      folder: 'auto-video-generator/voice-previews',
      format: (() => {
        const name = String(voiceResult.filename ?? '')
          .trim()
          .toLowerCase();
        const match = /\.([a-z0-9]+)$/.exec(name);
        return match?.[1];
      })(),
    });

    await this.voiceOverRepository.update(
      { id: voice.id, user_id },
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

  private async ensureNamespacedForProvider(
    provider: VoiceProvider,
  ): Promise<void> {
    await this.ensureSchema();

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

  private async ensureSeeded(
    user_id: string,
    provider: VoiceProvider,
  ): Promise<void> {
    await this.ensureNamespacedForProvider(provider);

    const count = await this.voiceOverRepository.count({
      where: { user_id, provider },
    });
    if (count > 0) {
      // Keep Google/AI Studio catalog aligned to the prebuilt Gemini voice list.
      if (provider === 'google' && count !== this.geminiPrebuiltVoices.length) {
        await this.syncAllFromGoogleTts(user_id);
      }
      return;
    }

    const legacyRows = await this.voiceOverRepository.find({
      where: { user_id: IsNull(), provider } as any,
      order: { name: 'ASC' },
    });

    if (legacyRows.length > 0) {
      for (const row of legacyRows) {
        await this.upsertUserVoice({
          user_id,
          provider,
          rawId: this.stripNamespace(provider, row.voice_id),
          name: row.name,
          preview_url: row.preview_url ?? null,
          description: row.description ?? null,
          category: row.category ?? null,
          gender: row.gender ?? null,
          accent: row.accent ?? null,
          descriptive: row.descriptive ?? null,
          use_case: row.use_case ?? null,
        });
      }

      const hydratedCount = await this.voiceOverRepository.count({
        where: { user_id, provider },
      });
      if (
        provider === 'google' &&
        hydratedCount !== this.geminiPrebuiltVoices.length
      ) {
        await this.syncAllFromGoogleTts(user_id);
      }
      return;
    }

    // If table is empty for this provider, pull the catalog once.
    if (provider === 'elevenlabs') {
      await this.syncAllFromElevenLabs(user_id);
      return;
    }

    if (provider === 'google') {
      await this.syncAllFromGoogleTts(user_id);
      return;
    }
  }

  async syncAll(params?: {
    user_id: string;
    provider?: string;
  }): Promise<{ imported: number; updated: number }> {
    await this.ensureSchema();

    const provider = this.normalizeProvider(params?.provider);
    if (provider === 'elevenlabs') {
      return this.syncAllFromElevenLabs(params!.user_id);
    }
    return this.syncAllFromGoogleTts(params!.user_id);
  }

  async syncAllFromElevenLabs(user_id: string): Promise<{
    imported: number;
    updated: number;
  }> {
    await this.ensureSchema();

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

      const labels = voice.labels || {};

      const result = await this.upsertUserVoice({
        user_id,
        provider,
        rawId,
        name: voice.name,
        preview_url: voice.preview_url ?? null,
        description: voice.description ?? null,
        category: voice.category ?? null,
        gender: voice.gender ?? labels.gender ?? null,
        accent: voice.accent ?? labels.accent ?? null,
        descriptive: labels.descriptive ?? null,
        use_case: labels.use_case ?? null,
      });

      if (result.outcome === 'imported') {
        imported += 1;
      } else if (result.outcome === 'updated') {
        updated += 1;
      }
    }

    pageToken = data.next_page_token ?? null;

    return { imported, updated };
  }

  async importOneFromElevenLabs(
    user_id: string,
    voiceId: string,
  ): Promise<VoiceOver> {
    await this.ensureSchema();

    const provider: VoiceProvider = 'elevenlabs';
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new InternalServerErrorException(
        'ELEVENLABS_API_KEY is not configured on the server',
      );
    }

    const rawInput = String(voiceId ?? '').trim();
    if (!rawInput) {
      throw new BadRequestException('voiceId is required');
    }

    const rawId = this.stripNamespace(provider, rawInput);
    if (!rawId) {
      throw new BadRequestException('voiceId is required');
    }

    // Prefer the official SDK (it auto-reads ELEVENLABS_API_KEY by default).
    let voice: Partial<ElevenLabsVoice> | null = null;
    try {
      const client = new ElevenLabsClient({
        apiKey,
      });

      // Note: withSettings is deprecated upstream, but harmless.
      const result = await client.voices.get(
        rawId as any,
        {
          withSettings: true as any,
        } as any,
      );
      voice = (result ?? null) as any;
    } catch (error: any) {
      this.logger.warn(
        `ElevenLabs SDK fetch failed for voice ${rawId}; falling back to HTTP: ${error?.message ?? error}`,
      );

      const url = `https://api.elevenlabs.io/v1/voices/${encodeURIComponent(rawId)}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });

      if (response.status === 404) {
        // Best-effort cross-check: if the voice isn't in the caller's voice list,
        // it's usually because the voice belongs to a different account / isn't added
        // to the user's Voices list (e.g., copied from Voice Library) or the API key is for another workspace.
        try {
          const listRes = await fetch('https://api.elevenlabs.io/v1/voices', {
            method: 'GET',
            headers: {
              'xi-api-key': apiKey,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
          });

          if (listRes.ok) {
            const listData = (await listRes.json()) as ElevenLabsVoicesResponse;
            const ids = (listData.voices ?? [])
              .map((v) => String(v.voice_id ?? '').trim())
              .filter(Boolean);
            const inAccount = ids.includes(rawId);
            throw new NotFoundException(
              inAccount
                ? `ElevenLabs voice could not be fetched: ${rawId}. It appears in your voice list, but the details endpoint returned 404.`
                : `ElevenLabs voice not found in your account: ${rawId}. Make sure this voice is in your ElevenLabs Voices list and that ELEVENLABS_API_KEY is for the same account/workspace.`,
            );
          }
        } catch (e) {
          // ignore list-check errors and fall through
        }

        throw new NotFoundException(
          `ElevenLabs voice not found or not accessible with this API key: ${rawId}`,
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new UnauthorizedException(
          'Unauthorized to call ElevenLabs API. Check ELEVENLABS_API_KEY.',
        );
      }

      if (response.status === 400 || response.status === 422) {
        throw new BadRequestException('Invalid ElevenLabs voiceId');
      }

      if (response.status === 429) {
        throw new HttpException(
          'Rate limited by ElevenLabs. Please try again shortly.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (!response.ok) {
        const text = await response.text();
        this.logger.error(
          `Failed to fetch ElevenLabs voice ${rawId}: ${response.status} ${response.statusText} - ${text}`,
        );
        throw new InternalServerErrorException(
          'Failed to fetch ElevenLabs voice',
        );
      }

      voice = (await response.json()) as Partial<ElevenLabsVoice>;
    }

    if (!voice) {
      throw new InternalServerErrorException(
        'Failed to fetch ElevenLabs voice',
      );
    }
    const resolvedRawId = String(voice.voice_id ?? rawId).trim();
    if (!resolvedRawId) {
      throw new InternalServerErrorException(
        'ElevenLabs response missing voice_id',
      );
    }

    const nextVoiceId = this.namespacedVoiceId(provider, resolvedRawId);
    const labels = voice.labels || {};

    const result = await this.upsertUserVoice({
      user_id,
      provider,
      rawId: resolvedRawId,
      name: String(voice.name ?? '').trim() || nextVoiceId,
      preview_url: voice.preview_url ?? null,
      description: voice.description ?? null,
      category: voice.category ?? null,
      gender: voice.gender ?? labels.gender ?? null,
      accent: voice.accent ?? labels.accent ?? null,
      descriptive: labels.descriptive ?? null,
      use_case: labels.use_case ?? null,
    });

    return result.row;
  }

  async syncAllFromGoogleTts(
    user_id: string,
  ): Promise<{ imported: number; updated: number }> {
    await this.ensureSchema();

    let imported = 0;
    let updated = 0;

    const provider: VoiceProvider = 'google';
    const allowedVoiceIds = this.geminiPrebuiltVoices
      .map((v) => this.namespacedVoiceId(provider, v.name))
      .filter(Boolean);

    for (const voice of this.geminiPrebuiltVoices) {
      const rawId = String(voice.name ?? '').trim();
      if (!rawId) continue;

      const result = await this.upsertUserVoice({
        user_id,
        provider,
        rawId,
        name: rawId,
        description: null,
        category: 'gemini-tts',
        gender: null,
        accent: null,
        descriptive: null,
        use_case: voice.style ?? 'AI Studio',
      });

      if (result.outcome === 'imported') {
        imported += 1;
      } else if (result.outcome === 'updated') {
        updated += 1;
      }
    }

    // Remove any old/unsupported Google voices (e.g., from previous Cloud TTS sync).
    // This keeps the UI aligned with AI Studio's prebuilt voice library.
    if (allowedVoiceIds.length > 0) {
      await this.voiceOverRepository.delete({
        user_id,
        provider,
        voice_id: Not(In(allowedVoiceIds)),
      });
    }

    return { imported, updated };
  }

  async findAll(params: {
    user_id: string;
    provider?: string;
  }): Promise<VoiceOver[]> {
    await this.ensureSchema();

    const provider = this.normalizeProvider(params?.provider);
    await this.ensureSeeded(params.user_id, provider);

    return this.voiceOverRepository.find({
      where: { user_id: params.user_id, provider },
      order: {
        isFavorite: 'DESC',
        name: 'ASC',
      },
    });
  }

  async setFavoriteByVoiceId(
    user_id: string,
    voiceId: string,
  ): Promise<VoiceOver> {
    await this.ensureSchema();

    const id = String(voiceId ?? '').trim();
    const candidates = [
      id,
      this.namespacedVoiceId('google', id),
      this.namespacedVoiceId('elevenlabs', id),
    ].filter(Boolean);

    const target = await this.ensureUserVoiceByCandidates({
      user_id,
      candidates,
    });

    if (!target) {
      throw new NotFoundException('Voice not found');
    }

    await this.voiceOverRepository.manager.transaction(async (manager) => {
      const repo = manager.getRepository(VoiceOver);

      // Use TypeORM metadata-aware updates so column naming/quoting works in Postgres
      await repo.update(
        { user_id, provider: target.provider, isFavorite: true },
        { isFavorite: false },
      );
      await repo.update({ id: target.id, user_id }, { isFavorite: true });
    });

    const updated = await this.voiceOverRepository.findOne({
      where: { id: target.id, user_id },
    });

    if (!updated) {
      throw new NotFoundException('Voice not found after update');
    }

    return updated;
  }
}
