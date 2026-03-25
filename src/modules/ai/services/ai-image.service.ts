import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { GenerateImageDto } from '../dto/generate-image.dto';
import { ImagesService } from '../../images/images.service';
import { ImageQuality, ImageSize } from '../../images/entities/image.entity';
import type { LlmMessage } from '../llm/llm-types';
import { AiRuntimeService } from './ai-runtime.service';
import { generateWithModelsLab } from './ai-image/providers/modelslab';
import { generateWithOpenAi } from './ai-image/providers/openai';
import { generateWithImagen } from './ai-image/providers/imagen';
import { generateWithLeonardo } from './ai-image/providers/leonardo';
import { generateWithGrokImagine } from './ai-image/providers/grok';
import type {
  CharacterBible,
  CharacterGender,
  CharacterProfile,
  ScriptLocationCacheEntry,
} from './ai-image/types';

@Injectable()
export class AiImageService {
  private static readonly OPENAI_IMAGE_MODELS = new Set([
    'gpt-image-1',
    'gpt-image-1-mini',
    'gpt-image-1.5',
  ]);

  private static readonly GROK_IMAGE_MODELS = new Set(['grok-imagine-image']);

  private static readonly GEMINI_IMAGE_MODELS = new Set([
    'gemini-2.5-flash-image',
    'gemini-3.1-flash-image-preview',
    'gemini-3-pro-image-preview',
    'imagen-3',
    'imagen-4',
    'imagen-4-ultra',
  ]);

  private readonly forbiddenIslamicDepictionRegex =
    /\b(allah|god|deity|divine\s*being|prophet|messenger\s+of\s+allah|rasul|rasool|muhammad|mohammad|ahmad|isa|jesus|moses|musa|ibrahim|abraham|noah|nuh|yusuf|joseph|yakub|yaqub|jacob|dawud|david|sulayman|solomon|yunus|jonah|aisha|khadija|fatima|abu\s*bakr|umar|u?thman|ali\b|sahaba|companions?|caliphs?|archangel|angel\s+gabriel|jibril|jibreel|quran\s+page|quranic\s+text|quran\s+verse|surah|ayah|arabic\s+text|quranic\s+script|mushaf|quran\s+book)\b/i;

  private readonly characterBibleCache = new Map<
    string,
    { expiresAt: number; bible: CharacterBible }
  >();

  private readonly scriptLocationCache = new Map<
    string,
    ScriptLocationCacheEntry
  >();

  private readonly sentenceLocationCache = new Map<
    string,
    ScriptLocationCacheEntry
  >();

  constructor(
    private readonly runtime: AiRuntimeService,
    private readonly imagesService: ImagesService,
  ) { }

  private static readonly NO_TEXT_PROMPT_SUFFIX =
    'No text, no letters, no words, no captions, no subtitles, no watermark, no logo, no signature, no symbols, no numbers.';

  private enforceNoTextInPrompt(raw: string): string {
    const prompt = String(raw ?? '').trim();
    if (!prompt) return prompt;

    const lowered = prompt.toLowerCase();
    const alreadyHasNoTextRule =
      lowered.includes('no text') ||
      lowered.includes('no letters') ||
      lowered.includes('do not add any textual') ||
      lowered.includes('no watermark') ||
      lowered.includes('no logo');

    if (alreadyHasNoTextRule) return prompt;
    return `${prompt}, ${AiImageService.NO_TEXT_PROMPT_SUFFIX}`;
  }

  private get llm() {
    return this.runtime.llm;
  }
  private get model() {
    return this.runtime.model;
  }
  private get cheapModel() {
    return this.runtime.cheapModel;
  }
  private get openai() {
    return this.runtime.openai;
  }
  private get grokApiKey() {
    return this.runtime.grokApiKey;
  }
  private get geminiApiKey() {
    return this.runtime.geminiApiKey;
  }
  private get leonardoApiKey() {
    return this.runtime.leonardoApiKey;
  }
  private get leonardoModelId() {
    return this.runtime.leonardoModelId;
  }

  private extractLeonardoPlatformModelCandidates(payload: unknown): any[] {
    if (!payload || typeof payload !== 'object') return [];

    const queue: unknown[] = [payload];
    const seen = new Set<unknown>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || typeof current !== 'object' || seen.has(current)) {
        continue;
      }
      seen.add(current);

      if (Array.isArray(current)) {
        if (current.some((item) => item && typeof item === 'object')) {
          return current;
        }
        continue;
      }

      for (const value of Object.values(current)) {
        if (Array.isArray(value)) {
          if (value.some((item) => item && typeof item === 'object')) {
            return value;
          }
          continue;
        }

        if (value && typeof value === 'object') {
          queue.push(value);
        }
      }
    }

    return [];
  }

  private normalizeLeonardoPlatformModel(raw: any): {
    id: string;
    value: string;
    name: string;
    provider: string;
    label: string;
    isDefault: boolean;
  } | null {
    const id = String(
      raw?.id ??
      raw?.modelId ??
      raw?.model_id ??
      raw?.platformModelId ??
      raw?.platform_model_id ??
      raw?.platformModel?.id ??
      raw?.platform_model?.id ??
      '',
    ).trim();

    if (!id) return null;

    const name = String(
      raw?.name ??
      raw?.displayName ??
      raw?.display_name ??
      raw?.modelName ??
      raw?.model_name ??
      raw?.title ??
      raw?.slug ??
      id,
    ).trim();

    const provider =
      String(
        raw?.provider ??
        raw?.providerName ??
        raw?.provider_name ??
        raw?.vendor ??
        raw?.owner ??
        raw?.organization ??
        'Leonardo',
      ).trim() || 'Leonardo';

    const normalizedProvider =
      provider === 'Leonardo.Ai' ? 'Leonardo' : provider;
    const label = name.toLowerCase().includes(normalizedProvider.toLowerCase())
      ? name
      : `${normalizedProvider} - ${name}`;
    const configuredId = String(this.leonardoModelId ?? '').trim();

    return {
      id,
      value: `leonardo:${id}`,
      name,
      provider: normalizedProvider,
      label,
      isDefault: Boolean(configuredId) && configuredId === id,
    };
  }

  private isNativeLeonardoPlatformModel(model: {
    provider: string;
    name: string;
  }): boolean {
    const provider = String(model.provider ?? '')
      .trim()
      .toLowerCase();
    const name = String(model.name ?? '')
      .trim()
      .toLowerCase();

    if (provider === 'leonardo' || provider === 'leonardo.ai') {
      return true;
    }

    return (
      name.startsWith('leonardo ') ||
      name.startsWith('lucid ') ||
      name.startsWith('phoenix')
    );
  }

  async listLeonardoModels(params?: { query?: string }): Promise<{
    models: Array<{
      id: string;
      value: string;
      name: string;
      provider: string;
      label: string;
      isDefault: boolean;
    }>;
  }> {
    if (!this.leonardoApiKey) {
      throw new InternalServerErrorException(
        'LEONARDO_API_KEY is not configured on the server',
      );
    }

    const response = await fetch(
      'https://cloud.leonardo.ai/api/rest/v1/platformModels',
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
          Authorization: `Bearer ${this.leonardoApiKey}`,
        },
      } as any,
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('Leonardo list platform models failed', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
      });
      throw new InternalServerErrorException(
        'Failed to load Leonardo platform models',
      );
    }

    const rawText = await response.text();
    let payload: unknown = {};

    try {
      payload = rawText ? JSON.parse(rawText) : {};
    } catch {
      console.error('Leonardo list platform models returned invalid JSON', {
        body: rawText,
      });
      throw new InternalServerErrorException(
        'Leonardo platform models returned an invalid response',
      );
    }

    const normalized = this.extractLeonardoPlatformModelCandidates(payload)
      .map((model) => this.normalizeLeonardoPlatformModel(model))
      .filter(Boolean) as Array<{
        id: string;
        value: string;
        name: string;
        provider: string;
        label: string;
        isDefault: boolean;
      }>;

    const deduped = normalized
      .filter((model) => this.isNativeLeonardoPlatformModel(model))
      .filter(
        (model, index, collection) =>
          collection.findIndex((candidate) => candidate.id === model.id) ===
          index,
      );

    const configuredId = String(this.leonardoModelId ?? '').trim();
    if (configuredId && !deduped.some((model) => model.id === configuredId)) {
      deduped.unshift({
        id: configuredId,
        value: `leonardo:${configuredId}`,
        name: 'Server Default',
        provider: 'Leonardo',
        label: `Leonardo - Server Default (${configuredId})`,
        isDefault: true,
      });
    }

    const query = String(params?.query ?? '')
      .trim()
      .toLowerCase();

    const filtered = query
      ? deduped.filter((model) => {
        const haystack = [
          model.id,
          model.value,
          model.name,
          model.provider,
          model.label,
        ]
          .join(' ')
          .toLowerCase();

        return haystack.includes(query);
      })
      : deduped;

    filtered.sort((left, right) => {
      if (left.isDefault !== right.isDefault) {
        return left.isDefault ? -1 : 1;
      }

      return left.label.localeCompare(right.label);
    });

    return { models: filtered };
  }

  private sentenceContainsMaleCharacter(text: string): boolean {
    const s = (text ?? '').trim();
    if (!s) return false;
    return (
      /\b(he|him|his|himself)\b/i.test(s) ||
      /\b(man|men|male|boy|father|dad|son|brother|husband|gentleman|king|prince)\b/i.test(
        s,
      )
    );
  }

  private hashScriptForCache(script: string): string {
    return createHash('sha1').update(script, 'utf8').digest('hex');
  }

  private hashSentenceLocationForCache(params: {
    script: string;
    sentence: string;
  }): string {
    return createHash('sha1')
      .update(params.script, 'utf8')
      .update('\n---\n', 'utf8')
      .update(params.sentence, 'utf8')
      .digest('hex');
  }

  private normalizeLocation(raw: unknown): string | null {
    const location = String(
      (raw && typeof raw === 'object' ? (raw as any).location : raw) ?? '',
    )
      .replace(/\s+/g, ' ')
      .trim();
    if (!location) return null;

    const capped =
      location.length > 80 ? location.slice(0, 77).trimEnd() + '...' : location;
    return capped;
  }

  private async getOrCreateLocationForSentence(params: {
    scriptRaw?: string | null;
    sentenceRaw?: string | null;
  }): Promise<string | null> {
    const sentence = (params.sentenceRaw ?? '').trim();
    if (!sentence) return null;

    const script = (params.scriptRaw ?? '').trim();

    const key = this.hashSentenceLocationForCache({ script, sentence });
    const now = Date.now();
    const cached = this.sentenceLocationCache.get(key);
    if (cached && cached.expiresAt > now) return cached.location;

    const messages: LlmMessage[] = [
      {
        role: 'system',
        content:
          'You infer the canonical LOCATION for a SINGLE target sentence, using the script only as context.\n' +
          'Return ONLY valid JSON with exactly this shape: {"location": string}.\n\n' +
          'Rules:\n' +
          '- Infer a location ONLY if the TARGET SENTENCE clearly implies a distinct environment, place, time-of-day situation, or atmospheric setting.\n' +
          '- Use SCRIPT CONTEXT only to resolve references/pronouns related to the TARGET SENTENCE.\n' +
          '- If the target sentence does NOT imply a clear location, return {"location": ""}.\n' +
          '- Do NOT guess.\n' +
          '- Keep the label short and suitable to prepend as "Location:" (e.g. "Desert caravan route at dusk", "Ottoman court interior", "Stormy coastal cliff").\n' +
          '- Do NOT include explanations, quotes, or extra keys.',
      },
      {
        role: 'user',
        content:
          (script
            ? `SCRIPT CONTEXT (for reference resolution):\n${script}\n\n`
            : '') +
          `TARGET SENTENCE (infer location for this ONLY):\n${sentence}`,
      },
    ];

    const tryModel = async (model: string): Promise<string | null> => {
      const parsed = await this.llm.completeJson<unknown>({
        model,
        temperature: 0,
        maxTokens: 120,
        retries: 1,
        messages,
      });
      return this.normalizeLocation(parsed);
    };

    try {
      const location = await tryModel(this.cheapModel);

      if (!location) return null;

      const ttlMs = 30 * 60 * 1000;
      this.sentenceLocationCache.set(key, {
        location,
        expiresAt: now + ttlMs,
      });
      return location;
    } catch (error: any) {
      console.error(
        'Sentence-location extraction failed (cheap model). Falling back.',
        {
          message: error?.message,
          status: error?.status,
          code: error?.code,
          type: error?.type,
        },
      );

      try {
        const location = await tryModel(this.model);

        if (!location) return null;

        const ttlMs = 30 * 60 * 1000;
        this.sentenceLocationCache.set(key, {
          location,
          expiresAt: now + ttlMs,
        });
        return location;
      } catch (fallbackErr: any) {
        console.error(
          'Sentence-location extraction failed (fallback model). Disabling for this sentence temporarily.',
          {
            message: fallbackErr?.message,
            status: fallbackErr?.status,
            code: fallbackErr?.code,
            type: fallbackErr?.type,
          },
        );

        const ttlMs = 5 * 60 * 1000;
        this.sentenceLocationCache.set(key, {
          location: null,
          expiresAt: now + ttlMs,
        });
        return null;
      }
    }
  }

  private normalizeCharacterBible(raw: any): CharacterBible {
    const rawChars = Array.isArray(raw?.characters) ? raw.characters : [];

    const characters: CharacterProfile[] = rawChars
      .map((c: any, idx: number) => {
        const key = String(c?.key ?? `C${idx + 1}`).trim() || `C${idx + 1}`;
        const name = String(c?.name ?? '').trim() || key;
        const genderRaw = String(c?.gender ?? '')
          .trim()
          .toLowerCase();
        const gender: CharacterGender =
          genderRaw === 'male' || genderRaw === 'm'
            ? 'male'
            : genderRaw === 'female' || genderRaw === 'f'
              ? 'female'
              : 'unknown';
        const description = String(c?.description ?? '').trim();

        return { key, name, gender, description };
      })
      .filter((c: CharacterProfile) => Boolean(c.key) && Boolean(c.description))
      .filter((c: CharacterProfile) => c.gender !== 'female')
      .slice(0, 8);

    const byKey: Record<string, CharacterProfile> = {};
    for (const c of characters) byKey[c.key] = c;

    return { characters, byKey };
  }

  private async getOrCreateCharacterBible(
    scriptRaw?: string | null,
  ): Promise<CharacterBible | null> {
    const script = (scriptRaw ?? '').trim();
    if (!script) return null;

    const key = this.hashScriptForCache(script);
    const now = Date.now();
    const cached = this.characterBibleCache.get(key);
    if (cached && cached.expiresAt > now) return cached.bible;

    const messages: LlmMessage[] = [
      {
        role: 'system',
        content:
          'You extract a CHARACTER BIBLE for consistent image generation across multiple scenes.\n' +
          'Return ONLY valid JSON with exactly this shape: {"characters": [{"key": string, "name": string, "gender": "male"|"unknown", "description": string}]}.\n\n' +
          'Rules (must follow):\n' +
          '- Extract ONLY recurring or clearly implied characters that could be visually depicted.\n' +
          '- EXCLUDE any mention of Allah/God, any Prophet, any Sahaba/Companions, or any religious figure.\n' +
          '- EXCLUDE women/females entirely (do not output female characters).\n' +
          '- keys must be short like C1, C2, C3...\n' +
          '- description must include facial + physical attributes for consistency (age range, face, hair, beard, skin tone, body build, clothing/accessories).\n' +
          '- Keep descriptions concise but specific (1-2 sentences).\n' +
          '- If no safe characters exist, return {"characters": []}.',
      },
      {
        role: 'user',
        content: 'SCRIPT (extract character bible from this):\n' + script,
      },
    ];

    const tryModel = async (model: string): Promise<CharacterBible> => {
      const parsed = await this.llm.completeJson<unknown>({
        model,
        temperature: 0.2,
        maxTokens: 800,
        retries: 1,
        messages,
      });
      return this.normalizeCharacterBible(parsed);
    };

    try {
      const bible = await tryModel(this.cheapModel);
      const ttlMs = 30 * 60 * 1000;
      this.characterBibleCache.set(key, { bible, expiresAt: now + ttlMs });
      return bible;
    } catch (error: any) {
      console.error(
        'Character bible extraction failed (cheap model). Falling back.',
        {
          message: error?.message,
          status: error?.status,
          code: error?.code,
          type: error?.type,
        },
      );

      try {
        const bible = await tryModel(this.model);
        const ttlMs = 30 * 60 * 1000;
        this.characterBibleCache.set(key, { bible, expiresAt: now + ttlMs });
        return bible;
      } catch (fallbackErr: any) {
        console.error(
          'Character bible extraction failed (fallback model). Disabling for this script temporarily.',
          {
            message: fallbackErr?.message,
            status: fallbackErr?.status,
            code: fallbackErr?.code,
            type: fallbackErr?.type,
          },
        );

        const empty: CharacterBible = { characters: [], byKey: {} };
        const ttlMs = 5 * 60 * 1000;
        this.characterBibleCache.set(key, {
          bible: empty,
          expiresAt: now + ttlMs,
        });
        return empty;
      }
    }
  }

  private async mapSentenceToCharacterKeys(params: {
    sentence: string;
    script?: string | null;
    bible: CharacterBible;
  }): Promise<string[]> {
    const sentence = (params.sentence ?? '').trim();
    if (!sentence) return [];
    if (!params.bible.characters.length) return [];

    const script = (params.script ?? '').trim();
    const characterList = params.bible.characters
      .map((c) => `${c.key}: ${c.name} — ${c.description}`)
      .join('\n');

    const nameToKey = new Map<string, string>();
    for (const c of params.bible.characters) {
      const nameKey = String(c.name ?? '')
        .trim()
        .toLowerCase();
      if (nameKey) nameToKey.set(nameKey, c.key);
    }

    let parsed: unknown;
    try {
      parsed = await this.llm.completeJson<unknown>({
        model: this.cheapModel,
        retries: 1,
        messages: [
          {
            role: 'system',
            content:
              'You map a single sentence to referenced character keys. ' +
              'Return ONLY valid JSON with exactly this shape: {"keys": string[]}.\n\n' +
              'Rules:\n' +
              '- Use the character list provided.\n' +
              '- IMPORTANT: The array MUST contain ONLY character KEYS from the list (e.g. "C1"), NOT character names.\n' +
              '- Include a key ONLY if the sentence clearly refers to that character (name, title, or unambiguous pronoun reference).\n' +
              '- If unclear, return an empty array.\n' +
              '- Never invent new keys.\n\n' +
              'Example output: {"keys": ["C2"]}',
          },
          {
            role: 'user',
            content:
              (script
                ? `SCRIPT CONTEXT (for pronoun resolution):\n${script}\n\n`
                : '') +
              `CHARACTER LIST (keys you are allowed to output):\n${characterList}\n\nSENTENCE:\n${sentence}`,
          },
        ],
      });
    } catch (error: any) {
      console.error(
        'Character key mapping failed; skipping character injection for this sentence.',
        {
          message: error?.message,
          status: error?.status,
          code: error?.code,
          type: error?.type,
        },
      );
      return [];
    }

    const keysRaw: unknown[] = Array.isArray((parsed as any)?.keys)
      ? ((parsed as any).keys as unknown[])
      : [];

    const coerceToKey = (raw: string): string | null => {
      const s = String(raw ?? '').trim();
      if (!s) return null;

      if (params.bible.byKey[s]) return s;

      const byName = nameToKey.get(s.toLowerCase());
      if (byName && params.bible.byKey[byName]) return byName;

      const keyMatch = s.match(/\b(C\d{1,2})\b/i);
      if (keyMatch) {
        const k = keyMatch[1].toUpperCase();
        if (params.bible.byKey[k]) return k;
      }

      const lowered = s.toLowerCase();
      for (const c of params.bible.characters) {
        const cn = String(c.name ?? '')
          .trim()
          .toLowerCase();
        if (!cn) continue;
        if (cn === lowered || cn.includes(lowered) || lowered.includes(cn)) {
          if (params.bible.byKey[c.key]) return c.key;
        }
      }

      return null;
    };

    const normalizedKeys: string[] = keysRaw
      .map((k) => coerceToKey(String(k)))
      .filter((k): k is string => Boolean(k));

    return Array.from(new Set<string>(normalizedKeys)).slice(0, 3);
  }

  private async sentenceMentionsAllahProphetOrSahaba(params: {
    script?: string | null;
    sentence: string;
    characters?: Array<{
      key: string;
      name: string;
      description: string;
      isSahaba: boolean;
      isProphet: boolean;
      isWoman: boolean;
    }> | null;
    characterBible?: CharacterBible | null;
  }): Promise<{
    blockHumans: boolean;
    forceBackView: boolean;
    characterKeys: string[];
  }> {
    const sentence = (params.sentence ?? '').trim();
    if (!sentence) {
      return {
        blockHumans: false,
        forceBackView: false,
        characterKeys: [],
      };
    }

    const script = (params.script ?? '').trim();

    const canonicalCharacters = (params.characters ?? []).filter(Boolean);
    const charactersByKey = new Map(
      canonicalCharacters.map((c) => [String(c.key).trim(), c] as const),
    );

    const sanitizeKeys = (keys: unknown): string[] => {
      const arr = Array.isArray(keys) ? keys : [];
      const out: string[] = [];
      const used = new Set<string>();
      for (const k of arr) {
        const kk = String(k ?? '').trim();
        if (!kk || used.has(kk)) continue;
        if (canonicalCharacters.length && !charactersByKey.has(kk)) continue;
        used.add(kk);
        out.push(kk);
        if (out.length >= 3) break;
      }
      return out;
    };

    try {
      // Preferred path: use canonical characters extracted during splitting.
      if (canonicalCharacters.length) {
        const parsed = await this.llm.completeJson<unknown>({
          model: this.cheapModel,
          retries: 1,
          messages: [
            {
              role: 'system',
              content:
                'You classify whether the TARGET SENTENCE refers (directly, via pronoun or via possessive pronoun) to Allah/God, and which canonical character(s) it refers to.\n' +
                'Return ONLY valid JSON with this exact shape: {"mentionsAllah": boolean, "characterKeys": string[]}.\n\n' +
                'Rules:\n' +
                'Use SCRIPT CONTEXT to resolve pronouns, possessive pronouns and references to the character keys in the TARGET SENTENCE.\n',
            },
            {
              role: 'user',
              content:
                (script
                  ? `SCRIPT CONTEXT (for pronouns references):\n${script}\n\n`
                  : '') +
                `CANONICAL CHARACTERS (keys you may output):\n${canonicalCharacters
                  .map((c) => `${c.key}: ${c.name}`)
                  .join('\n')}\n\n` +
                `TARGET SENTENCE:\n${sentence}`,
            },
          ],
        });

        const mentionsAllah = Boolean((parsed as any)?.mentionsAllah);
        const characterKeys = sanitizeKeys((parsed as any)?.characterKeys);

        const mentionsProphetOrSahaba = characterKeys.some((k) => {
          const c = charactersByKey.get(k);
          return Boolean(c && (c.isSahaba || c.isProphet));
        });
        const mentionsProphet = characterKeys.some((k) => {
          const c = charactersByKey.get(k);
          return Boolean(c && c.isProphet);
        });
        const mentionsWoman = characterKeys.some((k) => {
          const c = charactersByKey.get(k);
          return Boolean(c && c.isWoman);
        });

        const forceBackView = mentionsProphetOrSahaba;
        const blockHumans = Boolean(
          mentionsWoman || (mentionsAllah && !forceBackView),
        );

        return {
          blockHumans,
          forceBackView,
          characterKeys,
        };
      }

      // Fallback path: classify the safety-sensitive mention type directly.
      const parsed = await this.llm.completeJson<unknown>({
        model: this.cheapModel,
        temperature: 0,
        maxTokens: 80,
        retries: 1,
        messages: [
          {
            role: 'system',
            content:
              'You classify whether the TARGET SENTENCE refers to specific protected entities.\n' +
              'Return ONLY valid JSON with this exact shape: {"mentionsAllah": boolean, "mentionsProphet": boolean, "mentionsProphetOrSahaba": boolean, "mentionsWoman": boolean}.\n\n' +
              'Rules:\n' +
              '- Use SCRIPT CONTEXT only to resolve pronouns / references for the TARGET SENTENCE.\n' +
              '- mentionsAllah: true only if the sentence refers to Allah / God in Islamic context.\n' +
              '- mentionsProphet: true only if the sentence refers to any Prophet.\n' +
              '- mentionsProphetOrSahaba: true if the sentence refers to any Prophet OR any Sahaba / Companion.\n' +
              '- mentionsWoman: true only if the sentence refers to a woman/female person.\n' +
              '- If unclear/ambiguous, use false for that field.\n' +
              '- Do not include explanations or extra keys.',
          },
          {
            role: 'user',
            content:
              (script
                ? `SCRIPT CONTEXT (for reference resolution):\n${script}\n\n`
                : '') + `TARGET SENTENCE:\n${sentence}`,
          },
        ],
      });

      const mentionsAllah = Boolean((parsed as any)?.mentionsAllah);
      const mentionsProphet = Boolean((parsed as any)?.mentionsProphet);
      const mentionsProphetOrSahaba = Boolean(
        (parsed as any)?.mentionsProphetOrSahaba,
      );
      const mentionsWoman = Boolean((parsed as any)?.mentionsWoman);

      const forceBackView = mentionsProphetOrSahaba;
      const blockHumans = Boolean(
        mentionsWoman || (mentionsAllah && !forceBackView),
      );

      if (blockHumans || forceBackView) {
        return {
          blockHumans,
          forceBackView,
          characterKeys: [],
        };
      }

      if (params.characterBible && params.characterBible.characters.length) {
        const characterKeys = await this.mapSentenceToCharacterKeys({
          sentence,
          script: params.script,
          bible: params.characterBible,
        });
        return {
          blockHumans: false,
          forceBackView: false,
          characterKeys,
        };
      }

      return {
        blockHumans: false,
        forceBackView: false,
        characterKeys: [],
      };
    } catch (error) {
      console.error('Error classifying Allah/Prophet/Sahaba reference:', error);
      return {
        blockHumans: false,
        forceBackView: false,
        characterKeys: [],
      };
    }
  }

  private computeIsShortForm(dto: GenerateImageDto): boolean {
    const rawLength = String(dto.scriptLength ?? '')
      .trim()
      .toLowerCase();

    const parsedMinutes: number | null = (() => {
      const secondsMatch = /([0-9]+(?:\.[0-9]+)?)\s*second/u.exec(rawLength);
      if (secondsMatch?.[1]) {
        const seconds = Number(secondsMatch[1]);
        return Number.isFinite(seconds) ? seconds / 60 : null;
      }

      const minutesMatch = /([0-9]+(?:\.[0-9]+)?)\s*minute/u.exec(rawLength);
      if (minutesMatch?.[1]) {
        const minutes = Number(minutesMatch[1]);
        return Number.isFinite(minutes) ? minutes : null;
      }

      return null;
    })();

    // Hard rule: scripts longer than 3 minutes are treated as non-short.
    if (
      typeof parsedMinutes === 'number' &&
      Number.isFinite(parsedMinutes) &&
      parsedMinutes > 3
    ) {
      return false;
    }

    // Respect explicit overrides for <= 3 minutes.
    if (typeof dto.isShort === 'boolean') {
      return dto.isShort;
    }

    if (typeof parsedMinutes === 'number' && Number.isFinite(parsedMinutes)) {
      return parsedMinutes <= 3;
    }

    // Fallback for older/unknown strings.
    return (
      rawLength.includes('30 second') ||
      rawLength.includes('1 minute') ||
      rawLength.includes('2 minute') ||
      rawLength.includes('3 minute')
    );
  }

  private resolveAspectRatio(dto: GenerateImageDto): {
    aspectRatio: '16:9' | '9:16' | '1:1';
    isShortForm: boolean;
    width: number;
    height: number;
  } {
    const raw = String((dto as any).aspectRatio ?? '').trim();

    if (raw === '1:1') {
      return {
        aspectRatio: '1:1',
        isShortForm: false,
        width: 1024,
        height: 1024,
      };
    }

    if (raw === '9:16') {
      return {
        aspectRatio: '9:16',
        isShortForm: true,
        width: 768,
        height: 1344,
      };
    }

    if (raw === '16:9') {
      return {
        aspectRatio: '16:9',
        isShortForm: false,
        width: 1344,
        height: 768,
      };
    }

    const isShortForm = this.computeIsShortForm(dto);
    return {
      aspectRatio: isShortForm ? '9:16' : '16:9',
      isShortForm,
      width: isShortForm ? 768 : 1344,
      height: isShortForm ? 1344 : 768,
    };
  }

  private validateAndNormalizeImageModel(dto: GenerateImageDto): {
    imageModel: string;
    isModelsLab: boolean;
    modelslabModelId: string;
    isLeonardo: boolean;
    leonardoModelIdOverride: string;
  } {
    const imageModelRaw = String(dto.imageModel ?? '')
      .trim()
      .toLowerCase();
    const imageModel = imageModelRaw || 'leonardo';
    const isLeonardo =
      imageModel === 'leonardo' || imageModel.startsWith('leonardo:');
    const leonardoModelIdOverride =
      isLeonardo && imageModel.startsWith('leonardo:')
        ? imageModel.slice('leonardo:'.length).trim()
        : '';
    const isModelsLab = imageModel.startsWith('modelslab:');
    const modelslabModelId = isModelsLab
      ? imageModel.slice('modelslab:'.length).trim()
      : '';

    if (
      !isLeonardo &&
      !isModelsLab &&
      !AiImageService.OPENAI_IMAGE_MODELS.has(imageModel) &&
      !AiImageService.GROK_IMAGE_MODELS.has(imageModel) &&
      !AiImageService.GEMINI_IMAGE_MODELS.has(imageModel)
    ) {
      throw new BadRequestException(
        `Unsupported imageModel "${dto.imageModel}". Supported: leonardo, leonardo:<model_id>, grok-imagine-image, gpt-image-1, gpt-image-1-mini, gpt-image-1.5, gemini-2.5-flash-image, gemini-3.1-flash-image-preview, gemini-3-pro-image-preview, imagen-3, imagen-4, imagen-4-ultra, and modelslab:<model_id>.`,
      );
    }

    return {
      imageModel,
      isModelsLab,
      modelslabModelId,
      isLeonardo,
      leonardoModelIdOverride,
    };
  }

  private async persistToCloudinary(params: {
    userId: string;
    buffer: Buffer;
    base64: string;
    prompt: string;
    style: string;
    isShortForm: boolean;
  }): Promise<{
    prompt: string;
    imageBase64: string;
    imageUrl: string;
    savedImageId: string;
  }> {
    const saved = await this.imagesService.saveCompressedToCloudinary({
      buffer: params.buffer,
      filename: `ai-${Date.now()}.png`,
      user_id: params.userId,
      image_style: params.style,
      image_size: params.isShortForm ? ImageSize.PORTRAIT : ImageSize.LANDSCAPE,
      image_quality: ImageQuality.HIGH,
      prompt: params.prompt,
    });

    return {
      prompt: params.prompt,
      imageBase64: params.base64,
      imageUrl: saved.image,
      savedImageId: saved.id,
    };
  }

  async generateImageForSentence(dto: GenerateImageDto, userId: string) {
    // NOTE: this is moved as-is from AiService to preserve behavior.
    // It is intentionally large and will be further split later if desired.

    const style =
      dto.style?.trim() || 'Modern Anime style, 4K QUALITY DETAILED, vibrant';

    const fullScriptContext = dto.script?.trim();

    const frameType: 'single' | 'start' | 'end' =
      dto.frameType === 'start' || dto.frameType === 'end'
        ? dto.frameType
        : 'single';
    const imageVariant: 'primary' | 'secondary' =
      dto.imageVariant === 'secondary' ? 'secondary' : 'primary';
    const continuityPrompt = dto.continuityPrompt?.trim();

    const sentenceText = (dto.sentence ?? '').trim();

    const canonicalCharacters = dto.characters?.length ? dto.characters : null;

    const canonicalLocations = Array.isArray(dto.locations)
      ? dto.locations
        .map((location) => ({
          key: String((location as any)?.key ?? '').trim(),
          name: String((location as any)?.name ?? '').trim(),
          description: String((location as any)?.description ?? '').trim(),
        }))
        .filter((location) => location.key && location.name)
      : [];

    const forcedLocationKeyProvided = dto.forcedLocationKey !== undefined;
    const requestedLocationKeyRaw = forcedLocationKeyProvided
      ? String(dto.forcedLocationKey ?? '').trim()
      : String(dto.locationKey ?? '').trim();

    const requestedLocation = requestedLocationKeyRaw
      ? (canonicalLocations.find(
        (location) => location.key === requestedLocationKeyRaw,
      ) ?? null)
      : null;

    const forcedCharacterKeysInput = Array.isArray(dto.forcedCharacterKeys)
      ? dto.forcedCharacterKeys
      : null;
    const forcedCharactersProvided = forcedCharacterKeysInput !== null;
    const forcedKeysRaw = forcedCharactersProvided
      ? forcedCharacterKeysInput
        .map((k) => String(k ?? '').trim())
        .filter(Boolean)
      : [];
    const forcedKeys = canonicalCharacters?.length
      ? forcedKeysRaw.filter((k) =>
        canonicalCharacters.some((c) => c.key === k),
      )
      : [];
    const useForcedCharactersOverride = forcedCharactersProvided;

    const characterBible = canonicalCharacters
      ? null
      : await this.getOrCreateCharacterBible(fullScriptContext);

    const inferredLocation =
      !requestedLocation && !forcedLocationKeyProvided
        ? await this.getOrCreateLocationForSentence({
          scriptRaw: fullScriptContext,
          sentenceRaw: sentenceText,
        })
        : null;

    const effectiveLocationLine = requestedLocation
      ? `Location: ${requestedLocation.description || requestedLocation.name}`
      : inferredLocation
        ? `Location: ${inferredLocation}`
        : '';

    const mentionResult = useForcedCharactersOverride
      ? (() => {
        const forcedReferencedCharacters = (canonicalCharacters ?? []).filter(
          (character) => forcedKeys.includes(character.key),
        );

        return {
          blockHumans: forcedReferencedCharacters.some(
            (character) => character.isWoman,
          ),
          forceBackView: forcedReferencedCharacters.some(
            (character) => character.isSahaba || character.isProphet,
          ),

          characterKeys: forcedKeys,
        };
      })()
      : await this.sentenceMentionsAllahProphetOrSahaba({
        script: fullScriptContext,
        sentence: dto.sentence,
        characters: canonicalCharacters,
        characterBible,
      });

    const referencedCharacterKeys = mentionResult.characterKeys;
    const referencedCanonicalCharacters = (canonicalCharacters ?? []).filter(
      (character) => referencedCharacterKeys.includes(character.key),
    );
    const hasMultipleReferencedCharacters = referencedCharacterKeys.length > 1;
    const protectedCharacters = referencedCanonicalCharacters.filter(
      (character) => character.isSahaba || character.isProphet,
    );
    const notProtectedCharacters = referencedCanonicalCharacters.filter(
      (character) => !character.isSahaba && !character.isProphet && !character.isWoman,
    );

    const noHumanFiguresRule = 'Do NOT show any character, person, or humanoid figure. ' +
      'Symbolize the sentence through environmental storytelling, meaningful objects, action traces, lighting, atmosphere, and aftermath details.';
    const protectedCharactersRole = protectedCharacters.length === 1 && !hasMultipleReferencedCharacters ?
      noHumanFiguresRule :
      hasMultipleReferencedCharacters && protectedCharacters.length > 1 ?
        noHumanFiguresRule :
        referencedCharacterKeys.length && protectedCharacters.length && referencedCharacterKeys.length !== protectedCharacters.length ?
          `Don't Show the protected character(s) (${protectedCharacters.map((c) => c.name).join(', ')}) at all, Only Show ${notProtectedCharacters.map((c: any) => c.name).join(', ')} as If there's no other character(s) with it/them on the scene.` :
          '';

    console.log(referencedCharacterKeys.length, protectedCharacters.length, 'targetedBackViewRule');
    try {
      let prompt = (dto.prompt ?? '').trim();
      if (!prompt) {
        const promptModelRaw = String(dto.promptModel ?? '').trim();
        const promptModel = promptModelRaw || this.model;

        const frameBlock =
          frameType === 'single'
            ? ''
            : (frameType === 'start'
              ? 'FRAME CONTEXT: This image is the START FRAME of the scene for the TARGET SENTENCE. Establish the environment and the beginning of the action. The prompt MUST include the words "START FRAME".'
              : 'FRAME CONTEXT: This image is the END FRAME of the SAME scene for the TARGET SENTENCE. It must be a direct continuation of the START FRAME with the SAME environment/camera/lighting/style; advance the action slightly so the two frames complete each other. The prompt MUST include the words "END FRAME".') +
            (continuityPrompt
              ? `\nCONTINUITY (must match exactly): ${continuityPrompt}`
              : '');
        const secondaryVariantBlock =
          imageVariant === 'secondary'
            ? 'VARIATION MODE: This image must be a complementary second still for the exact same sentence. Preserve the same environment, location, lighting, wardrobe, props, atmosphere, and the same character identities from the continuity prompt. Only vary the shot slightly through camera angle, framing, pose, body position, facial expression, or micro-action. Do not change the setting, cast, time of day, or art direction.'
            : '';

        const characterRefsBlock = referencedCharacterKeys.length
          ? (() => {
            const resolveDescription = (key: string): string | null => {
              if (notProtectedCharacters?.length) {
                const c = notProtectedCharacters.find((cc) => cc.key === key);
                return c ? `${c.name}: ${c.description}` : null;
              }
              if (characterBible) {
                const c = characterBible.byKey[key];
                return c ? `${c.name}: ${c.description}` : null;
              }
              return null;
            };

            const lines = referencedCharacterKeys
              .map(resolveDescription)
              .filter(Boolean)
              .join('\n');

            return lines
              ? 'CHARACTER CONSISTENCY (must include these exact attributes in the prompt):\n' +
              lines +
              '\n\n'
              : '';
          })()
          : '';
        if (!useForcedCharactersOverride) {
          console.log(referencedCharacterKeys, 'referencedCharacterKeys');
          console.log(effectiveLocationLine, 'effectiveLocationLine');
        } else {
          console.log(
            referencedCharacterKeys,
            'forced referencedCharacterKeys',
          );
        }

        try {
          const promptMessages: LlmMessage[] =
            imageVariant === 'secondary' && continuityPrompt
              ? [
                {
                  role: 'user',
                  content:
                    `Primary image prompt:\n${continuityPrompt}\n\n` +
                    'Slightly modify this prompt for a second image from the same extended scene. ' +
                    'Keep the same environment, location, lighting, props, wardrobe, atmosphere, art direction, and character identities. ' +
                    'Treat it as the next beat of the same moment. Only change the framing slightly and vary pose, micro-action, and especially facial expressions while preserving continuity. ' +
                    'Return only the revised image prompt text, with no quotation marks.',
                },
              ]
              : [
                {
                  role: 'system',
                  content: (() => {
                    return (
                      'You are a visual prompt engineer for image generation models. ' +
                        'Your prompt MUST visually express the exact sentence that is happening in the context of the script' +
                        'If there are more than one character or group of people you need to define what is the position of these character(s) or group of people related to each other(Looking at each other,Confronting,Fighting,etc...)' +
                        'Don\'t leave any important visual detail out, and be sure to include any important visual element that is implied by the sentence. ' +
                        'Don\'t mention the characters names' +
                        'Use reasoning to highlight the important objects and actions and stress on it in the prompt.' +
                        'ABSOLUTE RULE: The prompt must be 4 lines max with great detail' +
                        AiImageService.NO_TEXT_PROMPT_SUFFIX +
                        (frameBlock ? frameBlock + '\n' : '') +
                          (secondaryVariantBlock
                            ? secondaryVariantBlock + '\n'
                            : '') +
                        protectedCharactersRole +
                        (!referencedCharacterKeys.length && dto.sentence.toLowerCase().includes('prophet')
                          ? noHumanFiguresRule
                          : '')
                    );
                  })(),
                },
                {
                  role: 'user',
                  content:
                    (effectiveLocationLine
                      ? `SCRIPT LOCATION (use ONLY for environment structure, time of day):\n${effectiveLocationLine}\n\n`
                      : '') +
                    characterRefsBlock +
                    (secondaryVariantBlock
                      ? `${secondaryVariantBlock}\n\n`
                      : '') +
                    (frameBlock ? `${frameBlock}\n\n` : '') +
                    `Sentence: "${dto.sentence}"\n` +
                    `Desired style: ${style}.\n\n` +
                    'Important constraints:\n' +
                    'Do not depict women/females.\n' +
                    'Return only the final image prompt text, with these constraints already applied, and do not include any quotation marks.' +
                    'The prompt should be on point and concise to best capture the scene for image generation. ',
                },
              ];

          prompt =
            (
              await this.llm.completeText({
                model: promptModel,
                maxTokens: 250,
                temperature: 0.8,
                retries: 2,
                messages: promptMessages,
              })
            )?.trim() || dto.sentence;
        } catch (error: any) {
          console.error(
            'Prompt generation failed after retries; falling back to sentence.',
            {
              message: error?.message,
              status: error?.status,
              code: error?.code,
              type: error?.type,
            },
          );
          prompt = dto.sentence;
        }
        console.log('Generated prompt from LLM:', prompt);
      } else {
        console.log('Using provided prompt without LLM processing.');
        prompt = String(prompt ?? '').trim();
        const styleText = (style ?? '').trim();
        if (styleText) {
          const styleHints: RegExp[] = [];
          if (/\banime\b/i.test(styleText)) styleHints.push(/\banime\b/i);
          if (/\b(photo(realistic)?|realism|realistic)\b/i.test(styleText)) {
            styleHints.push(/\b(photo(realistic)?|realism|realistic)\b/i);
          }
          if (/\b(cinematic|film|movie)\b/i.test(styleText)) {
            styleHints.push(/\b(cinematic|film|movie)\b/i);
          }
          if (/\bwatercolor\b/i.test(styleText))
            styleHints.push(/\bwatercolor\b/i);
          if (/\b(3d|render|pbr)\b/i.test(styleText))
            styleHints.push(/\b(3d|render|pbr)\b/i);

          const hasAnyStyleHint = styleHints.some((re) => re.test(prompt));
          if (!hasAnyStyleHint) {
            prompt = `${prompt}, ${styleText}`;
          }
        }
      }

      // Enforce a strong "no text" constraint in the final prompt sent to providers,
      // unless the caller explicitly allows text (e.g. YouTube wallpapers/thumbnails).
      if (
        prompt.includes('quran') ||
        prompt.includes('verse') ||
        prompt.includes("qur'an")
      ) {
        prompt = this.enforceNoTextInPrompt(prompt);
      }

      const { aspectRatio, isShortForm, width, height } =
        this.resolveAspectRatio(dto);

      const {
        imageModel,
        isModelsLab,
        modelslabModelId,
        leonardoModelIdOverride,
      } = this.validateAndNormalizeImageModel(dto);

      if (isModelsLab) {
        const apiKey = String(
          process.env.STABLE_DIFFUSION_API_KEY ?? '',
        ).trim();
        const image = await generateWithModelsLab({
          apiKey,
          modelId: modelslabModelId,
          prompt,
          aspectRatio,
        });

        return this.persistToCloudinary({
          userId,
          buffer: image.buffer,
          base64: image.base64,
          prompt,
          style,
          isShortForm,
        });
      }
      prompt = `${prompt}, NO WOMEN, NO GIRLS, NO LADIES.`;
      if (AiImageService.OPENAI_IMAGE_MODELS.has(imageModel)) {
        const image = await generateWithOpenAi({
          openai: this.openai,
          imageModel,
          prompt,
          aspectRatio,
        });

        return this.persistToCloudinary({
          userId,
          buffer: image.buffer,
          base64: image.base64,
          prompt,
          style,
          isShortForm,
        });
      }

      if (AiImageService.GROK_IMAGE_MODELS.has(imageModel)) {
        const image = await generateWithGrokImagine({
          grokApiKey: this.grokApiKey,
          imageModel: imageModel as any,
          prompt,
          aspectRatio,
        });

        return this.persistToCloudinary({
          userId,
          buffer: image.buffer,
          base64: image.base64,
          prompt,
          style,
          isShortForm,
        });
      }

      if (AiImageService.GEMINI_IMAGE_MODELS.has(imageModel)) {
        const image = await generateWithImagen({
          geminiApiKey: this.geminiApiKey,
          imageModel: imageModel as any,
          prompt,
          aspectRatio,
        });

        return this.persistToCloudinary({
          userId,
          buffer: image.buffer,
          base64: image.base64,
          prompt,
          style,
          isShortForm,
        });
      }

      const leonardo = await generateWithLeonardo({
        leonardoApiKey: this.leonardoApiKey,
        leonardoModelId: leonardoModelIdOverride || this.leonardoModelId,
        prompt,
        width,
        height,
      });

      return this.persistToCloudinary({
        userId,
        buffer: leonardo.image.buffer,
        base64: leonardo.image.base64,
        prompt,
        style,
        isShortForm,
      });
    } catch (error) {
      const err: any = error;

      console.error('Image generation failed', {
        message: err?.message,
        status: err?.status,
        code: err?.code,
        type: err?.type,
        param: err?.param,
        error: err?.error,
      });

      const upstreamMessage =
        err?.error?.message || err?.message || 'Failed to generate image';

      if (err?.status === 400) {
        throw new BadRequestException(upstreamMessage);
      }

      if (err?.status === 401 || err?.status === 403) {
        throw new UnauthorizedException(upstreamMessage);
      }

      throw new InternalServerErrorException(upstreamMessage);
    }
  }
}
