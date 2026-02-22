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
  ScriptEraCacheEntry,
} from './ai-image/types';

@Injectable()
export class AiImageService {
  private static readonly OPENAI_IMAGE_MODELS = new Set([
    'gpt-image-1',
    'gpt-image-1-mini',
    'gpt-image-1.5',
  ]);

  private static readonly GROK_IMAGE_MODELS = new Set(['grok-imagine-image']);

  private static readonly IMAGEN_MODELS = new Set([
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

  private readonly scriptEraCache = new Map<string, ScriptEraCacheEntry>();

  constructor(
    private readonly runtime: AiRuntimeService,
    private readonly imagesService: ImagesService,
  ) {}

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

  private normalizeEra(raw: unknown): string | null {
    const era = String(
      (raw && typeof raw === 'object' ? (raw as any).era : raw) ?? '',
    )
      .replace(/\s+/g, ' ')
      .trim();
    if (!era) return null;

    const capped = era.length > 80 ? era.slice(0, 77).trimEnd() + '...' : era;
    return capped;
  }

  private async getOrCreateEra(
    scriptRaw?: string | null,
  ): Promise<string | null> {
    const script = (scriptRaw ?? '').trim();
    if (!script) return null;

    const key = this.hashScriptForCache(script);
    const now = Date.now();
    const cached = this.scriptEraCache.get(key);
    if (cached && cached.expiresAt > now) return cached.era;

    const messages: LlmMessage[] = [
      {
        role: 'system',
        content:
          'You infer the ERA / time period of a narration script for visual setting consistency.\n' +
          'Return ONLY valid JSON with exactly this shape: {"era": string}.\n\n' +
          'Rules:\n' +
          '- The value must be a short label suitable to prepend as "Era:" (e.g. "7th century Arabia", "Ottoman era", "Modern day", "Medieval era", "Ancient Egypt").\n' +
          '- If the script does not imply a clear time period, return {"era": ""}.\n' +
          '- Do NOT include explanations, quotes, or extra keys.',
      },
      {
        role: 'user',
        content: 'SCRIPT (infer era from this):\n' + script.slice(0, 8000),
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
      return this.normalizeEra(parsed);
    };

    try {
      const era = await tryModel(this.cheapModel);
      const ttlMs = 30 * 60 * 1000;
      this.scriptEraCache.set(key, { era, expiresAt: now + ttlMs });
      return era;
    } catch (error: any) {
      console.error('Era extraction failed (cheap model). Falling back.', {
        message: error?.message,
        status: error?.status,
        code: error?.code,
        type: error?.type,
      });

      try {
        const era = await tryModel(this.model);
        const ttlMs = 30 * 60 * 1000;
        this.scriptEraCache.set(key, { era, expiresAt: now + ttlMs });
        return era;
      } catch (fallbackErr: any) {
        console.error(
          'Era extraction failed (fallback model). Disabling for this script temporarily.',
          {
            message: fallbackErr?.message,
            status: fallbackErr?.status,
            code: fallbackErr?.code,
            type: fallbackErr?.type,
          },
        );

        const ttlMs = 5 * 60 * 1000;
        this.scriptEraCache.set(key, { era: null, expiresAt: now + ttlMs });
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

  private extractBooleanFromModelText(
    raw: string | null | undefined,
  ): boolean | null {
    const text = (raw ?? '').trim().toLowerCase();
    if (!text) return null;

    if (text === 'true' || text === 'yes' || text === 'y') return true;
    if (text === 'false' || text === 'no' || text === 'n') return false;

    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'boolean') return parsed;
      if (parsed && typeof parsed === 'object') {
        const v = parsed.mentions ?? parsed.result ?? parsed.value;
        if (typeof v === 'boolean') return v;
      }
    } catch {
      // ignore
    }

    if (/\btrue\b/.test(text) || /\byes\b/.test(text)) return true;
    if (/\bfalse\b/.test(text) || /\bno\b/.test(text)) return false;
    return null;
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
  }): Promise<{ mentions: boolean; characterKeys: string[] }> {
    const sentence = (params.sentence ?? '').trim();
    if (!sentence) return { mentions: false, characterKeys: [] };

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

        const mentionsRestrictedCharacter = characterKeys.some((k) => {
          const c = charactersByKey.get(k);
          return Boolean(c && (c.isSahaba || c.isProphet || c.isWoman));
        });
        console.log(mentionsAllah, characterKeys, 'New Payload');
        const mentions = mentionsAllah || mentionsRestrictedCharacter;
        return { mentions, characterKeys };
      }

      // Fallback path: boolean-only classifier.
      const raw = await this.llm.completeText({
        model: this.cheapModel,
        temperature: 0,
        maxTokens: 16,
        messages: [
          {
            role: 'system',
            content:
              'You are a strict boolean classifier. ' +
              'Return ONLY "true" or "false" (no punctuation, no extra text).\n\n' +
              'Task: Determine whether the TARGET SENTENCE mentions OR refers to any of the following (directly or via pronouns resolved using the provided SCRIPT CONTEXT):\n' +
              '1) Allah (or God when clearly used in Islamic context)\n' +
              '2) Any Prophet\n' +
              '3) Any Sahaba / Companion of the Prophet\n' +
              '4) Any Woman\n\n' +
              'Rules:\n' +
              '- Use SCRIPT CONTEXT only to resolve pronouns / references for the TARGET SENTENCE.\n' +
              '- If unclear/ambiguous, return false.',
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

      const parsed = this.extractBooleanFromModelText(raw);
      const mentions = parsed ?? false;
      if (mentions) return { mentions: true, characterKeys: [] };

      if (params.characterBible && params.characterBible.characters.length) {
        const characterKeys = await this.mapSentenceToCharacterKeys({
          sentence,
          script: params.script,
          bible: params.characterBible,
        });
        return { mentions: false, characterKeys };
      }

      return { mentions: false, characterKeys: [] };
    } catch (error) {
      console.error('Error classifying Allah/Prophet/Sahaba reference:', error);
      return { mentions: false, characterKeys: [] };
    }
  }

  private computeIsShortForm(dto: GenerateImageDto): boolean {
    const rawLength = String(dto.scriptLength ?? '').trim().toLowerCase();

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

  private validateAndNormalizeImageModel(dto: GenerateImageDto): {
    imageModel: string;
    isModelsLab: boolean;
    modelslabModelId: string;
  } {
    const imageModelRaw = String(dto.imageModel ?? '')
      .trim()
      .toLowerCase();
    const imageModel = imageModelRaw || 'leonardo';
    const isModelsLab = imageModel.startsWith('modelslab:');
    const modelslabModelId = isModelsLab
      ? imageModel.slice('modelslab:'.length).trim()
      : '';

    if (
      imageModel !== 'leonardo' &&
      !isModelsLab &&
      !AiImageService.OPENAI_IMAGE_MODELS.has(imageModel) &&
      !AiImageService.GROK_IMAGE_MODELS.has(imageModel) &&
      !AiImageService.IMAGEN_MODELS.has(imageModel)
    ) {
      throw new BadRequestException(
        `Unsupported imageModel "${dto.imageModel}". Supported: leonardo, grok-imagine-image, gpt-image-1, gpt-image-1-mini, gpt-image-1.5, imagen-3, imagen-4, imagen-4-ultra, and modelslab:<model_id>.`,
      );
    }

    return { imageModel, isModelsLab, modelslabModelId };
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
      dto.style?.trim() || 'Anime style, detailed, vibrant, high quality';

    const fullScriptContext = dto.script?.trim();

    const frameType: 'single' | 'start' | 'end' =
      dto.frameType === 'start' || dto.frameType === 'end'
        ? dto.frameType
        : 'single';
    const continuityPrompt = dto.continuityPrompt?.trim();

    const sentenceText = (dto.sentence ?? '').trim();

    const canonicalCharacters = dto.characters?.length ? dto.characters : null;

    const forcedKeysRaw = Array.isArray(dto.forcedCharacterKeys)
      ? dto.forcedCharacterKeys
          .map((k) => String(k ?? '').trim())
          .filter(Boolean)
      : [];
    const forcedKeys = canonicalCharacters?.length
      ? forcedKeysRaw.filter((k) =>
          canonicalCharacters.some((c) => c.key === k),
        )
      : [];
    const hasForcedCharacters = forcedKeys.length > 0;

    const characterBible = canonicalCharacters
      ? null
      : await this.getOrCreateCharacterBible(fullScriptContext);
    const scriptEra = await this.getOrCreateEra(fullScriptContext);
    const eraLine = scriptEra ? `Era:${scriptEra}` : '';

    const mentionResult = hasForcedCharacters
      ? { mentions: false, characterKeys: forcedKeys }
      : await this.sentenceMentionsAllahProphetOrSahaba({
          script: fullScriptContext,
          sentence: dto.sentence,
          characters: canonicalCharacters,
          characterBible,
        });

    const enforceNoHumanFigures = hasForcedCharacters
      ? false
      : mentionResult.mentions;
    const referencedCharacterKeys = hasForcedCharacters
      ? forcedKeys
      : enforceNoHumanFigures
        ? []
        : mentionResult.characterKeys;
    const focusMaleCharacter =
      !enforceNoHumanFigures &&
      (this.sentenceContainsMaleCharacter(sentenceText) ||
        referencedCharacterKeys.length > 0);

    const noHumanFiguresRule =
      'ABSOLUTE RULE: Do NOT depict any humans or human-like figures. ' +
      'NO people, NO faces, NO heads, NO hands, NO bodies, NO skin, NO silhouettes, NO characters, NO crowds, NO humanoid statues.';

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

        const characterRefsBlock = referencedCharacterKeys.length
          ? (() => {
              const resolveDescription = (key: string): string | null => {
                if (canonicalCharacters?.length) {
                  const c = canonicalCharacters.find((cc) => cc.key === key);
                  return c ? `${c.key}: ${c.description}` : null;
                }
                if (characterBible) {
                  const c = characterBible.byKey[key];
                  return c ? `${c.key}: ${c.description}` : null;
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

        if (!hasForcedCharacters) {
          console.log(mentionResult.mentions, 'mentionsAllah/Prophet/Sahaba');
          console.log(referencedCharacterKeys, 'referencedCharacterKeys');
        } else {
          console.log(
            referencedCharacterKeys,
            'forced referencedCharacterKeys',
          );
        }

        prompt =
          (
            await this.llm.completeText({
              model: promptModel,
              maxTokens: 250,
              temperature: 0.8,
              messages: [
                {
                  role: 'system',
                  content:
                    'You are a visual prompt engineer for image generation models. ' +
                    'Your prompt MUST visually express that emotion through composition, lighting, color palette, environment, and symbolism. ' +
                    'Make the result composition-rich, varied, imaginative, and cinematic (avoid generic defaults unless the sentence truly calls for it). ' +
                    'ABSOLUTE RULE: Do not add any textual elements in the image. ' +
                    AiImageService.NO_TEXT_PROMPT_SUFFIX +
                    (frameBlock ? frameBlock + '\n' : '') +
                    (enforceNoHumanFigures
                      ? noHumanFiguresRule
                      : referencedCharacterKeys.length
                        ? 'You MUST keep character appearance consistent with the provided CHARACTER CONSISTENCY block. Include ONLY the referenced character(s) and explicitly include their facial/physical attributes in the prompt.'
                        : ''),
                },
                {
                  role: 'user',
                  content:
                    (eraLine
                      ? `SCRIPT ERA (use ONLY for era/time):\n${eraLine}\n\n`
                      : '') +
                    characterRefsBlock +
                    (frameBlock ? `${frameBlock}\n\n` : '') +
                    `Sentence: "${dto.sentence}"\n` +
                    `Desired style: ${style}.\n\n` +
                    'Important constraints:\n' +
                    '- Do not depict women/females.\n' +
                    '- Do not add any textual elements in the image.\n' +
                    `- ${AiImageService.NO_TEXT_PROMPT_SUFFIX}\n` +
                    (enforceNoHumanFigures
                      ? '- ABSOLUTELY NO humans/human figures: no people, no faces, no hands, no bodies, no silhouettes.\n' +
                        `${noHumanFiguresRule}\n`
                      : focusMaleCharacter
                        ? '- Include the male character(s) implied by the sentence and focus on their action; do not add extra characters beyond what the sentence implies.\n'
                        : '') +
                    (referencedCharacterKeys.length
                      ? '- You MUST include the referenced character(s) facial + physical attributes from the CHARACTER CONSISTENCY block in your final prompt sentence.\n'
                      : '') +
                    'Return only the final image prompt text, with these constraints already applied, and do not include any quotation marks.',
                },
              ],
            })
          )?.trim() || dto.sentence;
      } else {
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

        if (frameType === 'start') {
          const hasStartFrame = /\bstart\s*frame\b/i.test(prompt);
          if (!hasStartFrame) {
            prompt = `${prompt}, START FRAME of the scene`;
          }
        } else if (frameType === 'end') {
          const hasEndFrame = /\bend\s*frame\b/i.test(prompt);
          if (!hasEndFrame) {
            prompt = `${prompt}, END FRAME of the same scene, same environment as the start frame, slightly progressed action`;
          }
          if (
            continuityPrompt &&
            !prompt.toLowerCase().includes('continuity')
          ) {
            prompt = `${prompt}, continuity to match: ${continuityPrompt}`;
          }
        }

        if (enforceNoHumanFigures) {
          const hasNoHumans =
            /\bno\s+(people|humans|human\s+figures?)\b|\bno\s+faces\b|\bno\s+hands\b|\bno\s+silhouettes\b|\bnon[-\s]?figurative\b/i.test(
              prompt,
            );
          if (!hasNoHumans) {
            prompt = `${prompt}, no people, no humans, no faces, no hands, no silhouettes`;
          }
        } else if (referencedCharacterKeys.length && characterBible) {
          const characterSuffix = referencedCharacterKeys
            .map((k) => characterBible.byKey[k])
            .filter(Boolean)
            .map((c) => `${c.key} (${c.description})`)
            .join(', ');
          if (
            characterSuffix &&
            !prompt.includes('CHARACTER') &&
            !prompt.includes('C1')
          ) {
            prompt = `${prompt}, character details: ${characterSuffix}`;
          }
        }
      }

      // Enforce a strong "no text" constraint in the final prompt sent to providers.
      prompt = this.enforceNoTextInPrompt(prompt);

      const isShortForm = this.computeIsShortForm(dto);
      const width = isShortForm ? 768 : 1344;
      const height = isShortForm ? 1344 : 768;

      const { imageModel, isModelsLab, modelslabModelId } =
        this.validateAndNormalizeImageModel(dto);

      if (isModelsLab) {
        const apiKey = String(
          process.env.STABLE_DIFFUSION_API_KEY ?? '',
        ).trim();
        const image = await generateWithModelsLab({
          apiKey,
          modelId: modelslabModelId,
          prompt,
          isShortForm,
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

      if (AiImageService.OPENAI_IMAGE_MODELS.has(imageModel)) {
        const image = await generateWithOpenAi({
          openai: this.openai,
          imageModel,
          prompt,
          isShortForm,
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
          isShortForm,
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

      if (AiImageService.IMAGEN_MODELS.has(imageModel)) {
        const image = await generateWithImagen({
          geminiApiKey: this.geminiApiKey,
          imageModel: imageModel as any,
          prompt,
          isShortForm,
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
        leonardoModelId: this.leonardoModelId,
        prompt,
        width,
        height,
      });

      // Some providers return a modified prompt; re-apply constraints.
      prompt = this.enforceNoTextInPrompt(leonardo.prompt);

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
