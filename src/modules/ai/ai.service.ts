import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import ffmpegPath from 'ffmpeg-static';
import * as ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { GenerateScriptDto } from './dto/generate-script.dto';
import { GenerateImageDto } from './dto/generate-image.dto';
import { EnhanceScriptDto } from './dto/enhance-script.dto';
import { EnhanceSentenceDto } from './dto/enhance-sentence.dto';
import { GenerateVideoFromFramesDto } from './dto/generate-video-from-frames.dto';
import { ImagesService } from '../images/images.service';
import { ImageQuality, ImageSize } from '../images/entities/image.entity';
import { LlmRouter } from './llm/llm-router';
import type { LlmMessage } from './llm/llm-types';
import { uploadBufferToCloudinary } from '../render-videos/utils/cloudinary.utils';

type UploadedImageFile = {
  buffer?: Buffer;
  mimetype?: string;
  size?: number;
  originalname?: string;
};

type CharacterGender = 'male' | 'female' | 'unknown';

type CharacterProfile = {
  key: string;
  name: string;
  gender: CharacterGender;
  description: string;
};

type CharacterBible = {
  characters: CharacterProfile[];
  byKey: Record<string, CharacterProfile>;
};

@Injectable()
export class AiService {
  private readonly openai: OpenAI | null;
  private readonly anthropic: Anthropic | null;
  private readonly llm: LlmRouter;
  private readonly model: string;
  private readonly cheapModel: string;
  private readonly imageModel: string;
  private readonly geminiApiKey?: string;
  private readonly geminiTtsModel: string;
  private readonly elevenApiKey?: string;
  private readonly elevenDefaultVoiceId: string;
  private readonly googleTtsDefaultVoiceName?: string;
  private readonly leonardoApiKey?: string;
  private readonly leonardoModelId?: string;

  private readonly forbiddenIslamicDepictionRegex =
    /\b(allah|god|deity|divine\s*being|prophet|messenger\s+of\s+allah|rasul|rasool|muhammad|mohammad|ahmad|isa|jesus|moses|musa|ibrahim|abraham|noah|nuh|yusuf|joseph|yakub|yaqub|jacob|dawud|david|sulayman|solomon|yunus|jonah|aisha|khadija|fatima|abu\s*bakr|umar|u?thman|ali\b|sahaba|companions?|caliphs?|archangel|angel\s+gabriel|jibril|jibreel|quran\s+page|quranic\s+text|quran\s+verse|surah|ayah|arabic\s+text|quranic\s+script|mushaf|quran\s+book)\b/i;

  private readonly characterBibleCache = new Map<
    string,
    { expiresAt: number; bible: CharacterBible }
  >();

  // Narration pacing assumption (words per minute) used to derive strict word-count targets.
  private readonly narrationWpm = 150;

  async generateVideoFromFrames(params: {
    prompt: string;
    model?: string;
    resolution?: string;
    aspectRatio?: string;
    isLooping?: boolean;
    startFrame: { buffer: Buffer; mimeType: string };
    endFrame?: { buffer: Buffer; mimeType: string };
  }): Promise<{ buffer: Buffer; mimeType: string; uri: string }> {
    if (!this.geminiApiKey) {
      throw new InternalServerErrorException(
        'GEMINI_API_KEY is not configured on the server',
      );
    }

    const prompt = String(params.prompt ?? '').trim();
    if (!prompt) {
      throw new BadRequestException('Prompt is required to generate a video');
    }

    const ai = new GoogleGenAI({ apiKey: this.geminiApiKey });

    const config: any = {
      numberOfVideos: 1,
      resolution: String(params.resolution ?? '').trim() || '720p',
    };

    // Default to portrait (shorts/reels) if not specified.
    const aspectRatio = String(params.aspectRatio ?? '').trim() || '9:16';
    config.aspectRatio = aspectRatio;

    const requestedModelRaw =
      String(params.model ?? '').trim() ||
      String(process.env.GEMINI_VIDEO_MODEL ?? '').trim();

    const requestedModel = requestedModelRaw || 'veo-3.0-fast-generate-001';

    const finalEndFrame = params.isLooping
      ? params.startFrame
      : params.endFrame;
    const hasSecondFrame = Boolean(finalEndFrame);

    // Veo 3 uses `endFrame` while older variants use `lastFrame`.
    const preferredSecondFrameKey: 'endFrame' | 'lastFrame' = requestedModel
      .toLowerCase()
      .startsWith('veo-3')
      ? 'endFrame'
      : 'lastFrame';

    const payload: any = {
      model: requestedModel,
      config,
      prompt,
      image: {
        imageBytes: params.startFrame.buffer.toString('base64'),
        mimeType: params.startFrame.mimeType,
      },
    };

    const setSecondFrame = (key: 'endFrame' | 'lastFrame' | null) => {
      delete payload.config.endFrame;
      delete payload.config.lastFrame;
      if (!finalEndFrame || !key) return;
      payload.config[key] = {
        imageBytes: finalEndFrame.buffer.toString('base64'),
        mimeType: finalEndFrame.mimeType,
      };
    };

    setSecondFrame(hasSecondFrame ? preferredSecondFrameKey : null);

    const isFrameParamUnsupported = (
      err: unknown,
      paramName: 'lastFrame' | 'endFrame',
    ) => {
      const msg =
        typeof err === 'object' && err !== null && 'message' in err
          ? String((err as any).message)
          : '';
      return (
        (msg.includes('`' + paramName + '`') || msg.includes(paramName)) &&
        (msg.includes("isn't supported") || msg.includes('is not supported'))
      );
    };

    const isModelNotFound = (err: unknown) => {
      const msg =
        typeof err === 'object' && err !== null && 'message' in err
          ? String((err as any).message)
          : '';
      return (
        msg.toLowerCase().includes('not found') ||
        (msg.toLowerCase().includes('model') &&
          msg.toLowerCase().includes('not') &&
          msg.toLowerCase().includes('available')) ||
        msg.includes('404')
      );
    };

    let operation;
    const callGenerate = () => ai.models.generateVideos(payload);

    try {
      operation = await callGenerate();
    } catch (err: unknown) {
      // Some models use `endFrame` instead of `lastFrame` (and vice versa).
      // When that happens, swap the field name and retry before dropping the second frame.
      if (hasSecondFrame && isFrameParamUnsupported(err, 'lastFrame')) {
        setSecondFrame('endFrame');
        operation = await callGenerate();
      } else if (hasSecondFrame && isFrameParamUnsupported(err, 'endFrame')) {
        setSecondFrame('lastFrame');
        operation = await callGenerate();
      } else if (payload.model === requestedModel && isModelNotFound(err)) {
        // If the preferred model isn't available for this API key/project,
        // fall back to Veo 2 so the feature still works.
        payload.model = 'veo-2.0-generate-001';
        // Veo 2 expects `lastFrame`.
        if (hasSecondFrame) setSecondFrame('lastFrame');
        try {
          operation = await callGenerate();
        } catch (fallbackErr: unknown) {
          // If the second-frame field name is rejected, try the other one, then drop it.
          if (
            hasSecondFrame &&
            isFrameParamUnsupported(fallbackErr, 'lastFrame')
          ) {
            setSecondFrame('endFrame');
            operation = await callGenerate();
          } else if (
            hasSecondFrame &&
            isFrameParamUnsupported(fallbackErr, 'endFrame')
          ) {
            setSecondFrame('lastFrame');
            operation = await callGenerate();
          } else {
            throw fallbackErr;
          }
        }
      } else {
        throw err;
      }
    }

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    while (!operation.done) {
      await sleep(10_000);
      operation = await ai.operations.getVideosOperation({ operation });
    }

    const videos = operation?.response?.generatedVideos;
    const first = Array.isArray(videos) && videos.length > 0 ? videos[0] : null;
    const uriRaw = first?.video?.uri;
    if (!uriRaw) {
      throw new InternalServerErrorException('No videos generated');
    }

    const uri = decodeURIComponent(String(uriRaw));
    const urlWithKey = `${uri}${uri.includes('?') ? '&' : '?'}key=${encodeURIComponent(
      this.geminiApiKey,
    )}`;

    const res = await fetch(urlWithKey);
    if (!res.ok) {
      throw new InternalServerErrorException(
        `Failed to fetch generated video: ${res.status} ${res.statusText}`,
      );
    }

    const mimeType = res.headers.get('content-type') || 'video/mp4';
    const arrayBuffer = await res.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType,
      uri,
    };
  }

  async generateVideoFromUploadedFrames(params: {
    userId: string;
    dto: GenerateVideoFromFramesDto;
    startFrameFile?: UploadedImageFile;
    endFrameFile?: UploadedImageFile;
  }): Promise<{ videoUrl: string }> {
    const prompt = String(params.dto?.prompt ?? '').trim();
    if (!prompt) {
      throw new BadRequestException('Prompt is required');
    }

    const isLooping = Boolean(params.dto?.isLooping);

    const fromUploaded = (
      file: UploadedImageFile | undefined,
      label: string,
    ) => {
      if (!file) return null;
      const mimeType = String(file.mimetype ?? '').trim();
      if (!mimeType || !mimeType.startsWith('image/')) {
        throw new BadRequestException(`${label} must be an image`);
      }
      if (
        !file.buffer ||
        !(file.buffer instanceof Buffer) ||
        file.buffer.length === 0
      ) {
        throw new BadRequestException(`${label} is missing file data`);
      }
      return { buffer: file.buffer, mimeType };
    };

    const start = fromUploaded(params.startFrameFile, 'Start frame');
    if (!start) {
      throw new BadRequestException('Start frame image is required');
    }

    const end = isLooping
      ? undefined
      : (fromUploaded(params.endFrameFile, 'End frame') ?? undefined);
    if (!isLooping && !end) {
      throw new BadRequestException('End frame image is required');
    }

    const generated = await this.generateVideoFromFrames({
      prompt,
      model: params.dto?.model,
      resolution: params.dto?.resolution,
      aspectRatio: params.dto?.aspectRatio,
      isLooping,
      startFrame: start,
      endFrame: end,
    });

    const uploaded = await uploadBufferToCloudinary({
      buffer: generated.buffer,
      folder: 'auto-video-generator/sentence-videos',
      resource_type: 'video',
    });

    return { videoUrl: uploaded.secure_url };
  }

  private normalizeTechnique(raw?: string | null): string | null {
    const s = (raw ?? '').trim();
    return s ? s : null;
  }

  private getTechniquePromptBlock(techniqueRaw?: string | null): string | null {
    const technique = this.normalizeTechnique(techniqueRaw);
    if (!technique) return null;

    switch (technique) {
      case 'The Dance (Context, Conflict)':
        return (
          'TECHNIQUE: The Dance (Context, Conflict)\n' +
          '- Make the story progress with constant movement using “but” / “therefore” turns (metaphorically).\n' +
          '- Create an open loop early (a clear question/tension) and pay it off later.\n' +
          '- Avoid flat “and then” stacking; each beat must add conflict (BUT) or cause the next step (THEREFORE).'
        );
      case 'Loss Aversion':
        return (
          'TECHNIQUE: Loss Aversion\n' +
          '- Frame the hook around what the viewer might miss if they skip: a mistake, a hidden insight, a consequence.\n' +
          '- Use urgency and stakes without being spammy, manipulative, or dishonest.\n' +
          '- Add mid-script curiosity re-opens (e.g., “but here’s what most people miss…”).'
        );
      case 'The Rhythm':
        return (
          'TECHNIQUE: The Rhythm\n' +
          '- Vary sentence length intentionally: mix short punchy lines with medium and a few longer lines.\n' +
          '- Keep cadence unpredictable; avoid runs of many long sentences.\n' +
          '- Prefer one sentence per line so rhythm is visible when read.'
        );
      case 'Confrontation Technique':
        return (
          'TECHNIQUE: Confrontation Technique\n' +
          '- Be blunt and direct. No hedging. No over-filtering.\n' +
          '- Make the idea visible and present; call out the tension plainly.\n' +
          '- Stay respectful (especially for religious subjects) but still decisive.'
        );
      default:
        return `TECHNIQUE: ${technique}\n- Apply this technique consistently throughout.`;
    }
  }

  constructor(private readonly imagesService: ImagesService) {
    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    this.geminiApiKey = (geminiKey || '').trim() || undefined;
    this.geminiTtsModel =
      String(process.env.GEMINI_TTS_MODEL ?? '').trim() ||
      'gemini-2.5-flash-preview-tts';

    this.openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;
    this.anthropic = anthropicKey
      ? new Anthropic({ apiKey: anthropicKey })
      : null;

    if (!this.openai && !this.anthropic && !(geminiKey || '').trim()) {
      throw new Error(
        'Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY in the environment.',
      );
    }

    this.llm = new LlmRouter({
      openai: this.openai,
      anthropic: this.anthropic,
      geminiApiKey: geminiKey,
    });

    // Default text model is Anthropic-first (as requested). Users can still explicitly
    // select OpenAI models from the UI.
    this.model =
      process.env.DEFAULT_TEXT_MODEL ||
      process.env.ANTHROPIC_DEFAULT_MODEL ||
      'claude-sonnet-4-5';

    // Used for small classification tasks (cheaper/faster than the main model).
    // Pick a sensible provider-specific default so we don't accidentally call a non-existent
    // model (which can spam logs during batch operations like "Generate All Images").
    const defaultCheapModel = ((): string => {
      if ((openaiKey ?? '').trim()) return 'gpt-4o-mini';
      if ((anthropicKey ?? '').trim()) return 'claude-3-haiku-20240307';
      if ((geminiKey ?? '').trim()) return 'gemini-1.5-flash';
      // Should be unreachable due to earlier guard, but keep a safe fallback.
      return 'gpt-4o-mini';
    })();

    this.cheapModel =
      process.env.DEFAULT_CHEAP_TEXT_MODEL ||
      process.env.ANTHROPIC_CHEAP_MODEL ||
      process.env.OPENAI_CHEAP_MODEL ||
      defaultCheapModel;

    // Kept for compatibility with any OpenAI image generation paths (if used).
    this.imageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
    this.elevenApiKey = process.env.ELEVENLABS_API_KEY;
    this.elevenDefaultVoiceId =
      process.env.ELEVENLABS_VOICE_ID || 'BtWabtumIemAotTjP5sk';

    // AI Studio voices (Gemini TTS)
    this.googleTtsDefaultVoiceName = process.env.GOOGLE_TTS_VOICE_NAME;

    this.leonardoApiKey = process.env.LEONARDO_API_KEY;
    this.leonardoModelId = process.env.LEONARDO_MODEL_ID;
  }

  private parseApproxLengthToSeconds(lengthRaw: string): number | null {
    const s = (lengthRaw || '').toLowerCase().trim();
    if (!s) return null;

    // Match patterns like "1 minute", "2.5 min", "90 seconds", "30 sec"
    const match = s.match(
      /(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m)\b/,
    );
    if (!match) return null;

    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) return null;

    const unit = match[2];
    const isSeconds = unit.startsWith('s');
    const seconds = isSeconds ? value : value * 60;

    // Cap to a reasonable range to avoid extreme prompts if user input is weird.
    if (seconds < 5) return 5;
    if (seconds > 60 * 30) return 60 * 30; // 30 minutes cap
    return Math.round(seconds);
  }

  private getStrictWordRange(lengthRaw: string): {
    targetWords: number;
    minWords: number;
    maxWords: number;
  } {
    const seconds = this.parseApproxLengthToSeconds(lengthRaw);

    const targetWords = seconds
      ? Math.max(20, Math.round((seconds / 60) * this.narrationWpm))
      : this.narrationWpm; // default ~1 minute

    // Strict tolerance: ~4% or at least 5 words.
    const tolerance = Math.max(5, Math.round(targetWords * 0.04));
    const minWords = Math.max(10, targetWords - tolerance);
    const maxWords = Math.max(minWords + 1, targetWords + tolerance);

    return { targetWords, minWords, maxWords };
  }

  private async containsForbiddenIslamicDepiction(
    text: string,
  ): Promise<boolean> {
    const s = (text || '').toLowerCase();
    if (!s) return false;

    // Quick checks first - explicit mentions
    if (
      s.includes('prophet') ||
      s.includes('sahaba') ||
      s.includes('companion') ||
      s.includes('quran page') ||
      s.includes('quranic text') ||
      s.includes('quran verse') ||
      s.includes('arabic text') ||
      s.includes('surah') ||
      s.includes('ayah') ||
      s.includes('mushaf')
    ) {
      return true;
    }

    // Check for explicit forbidden terms
    const hasExplicitTerms = this.forbiddenIslamicDepictionRegex.test(text);
    if (hasExplicitTerms) {
      return true;
    }

    // Check if text contains pronouns that might refer to forbidden entities
    const pronounRegex = /\b(he|him|his|himself|they|them|their|themselves)\b/i;
    const hasPronouns = pronounRegex.test(text);

    if (!hasPronouns) {
      return false;
    }

    // Use LLM to determine if pronouns refer to forbidden entities
    try {
      const raw = await this.llm.completeText({
        model: this.cheapModel,
        temperature: 0,
        maxTokens: 16,
        messages: [
          {
            role: 'system',
            content:
              'You are analyzing text for Islamic content rules. ' +
              'Determine if pronouns (he, him, his, they, them, their) in the text refer to: ' +
              'Allah/God, any prophet (Muhammad, Moses, Jesus, Abraham, etc.), or any Sahaba/Companion. ' +
              'Also check if the text mentions showing Quran pages, Quranic text, Arabic verses, or Mushaf. ' +
              'Respond with ONLY "yes" if pronouns refer to any forbidden entities OR if Quran pages/text are mentioned, or "no" if they refer to regular people or are unclear.',
          },
          {
            role: 'user',
            content: `Text to analyze: "${text}"\n\nDo the pronouns in this text refer to Allah, a prophet, or Sahaba/Companions?`,
          },
        ],
      });

      const response = raw?.trim().toLowerCase();
      return response === 'yes';
    } catch (error) {
      console.error('Error checking pronoun context:', error);
      // If LLM check fails, be conservative and return true if there are pronouns
      // in a potentially religious context
      const religiousContext =
        /\b(islam|muslim|quran|hadith|faith|allah|worship|prayer)\b/i.test(
          text,
        );
      return religiousContext && hasPronouns;
    }
  }

  private sentenceMentionsFemale(text: string): boolean {
    const s = (text ?? '').trim();
    if (!s) return false;
    return (
      /\b(she|her|hers|herself)\b/i.test(s) ||
      /\b(woman|women|female|girl|mother|mom|wife|sister|daughter|aunt|queen|princess)\b/i.test(
        s,
      )
    );
  }

  private hashScriptForCache(script: string): string {
    return createHash('sha1').update(script, 'utf8').digest('hex');
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
      // Enforce the product rule: never produce female character profiles.
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

    // Extract only allowed characters (exclude: Allah/Prophets/Sahaba and all women/females)
    // so we can keep visual consistency across sentence-level image prompts.
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
      // If the "cheap" model isn't available (common when users don't have access to a specific Anthropic alias),
      // fall back to the main model. If that also fails, cache an empty bible briefly to prevent log spam.
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
                ? `SCRIPT CONTEXT (for pronoun resolution):\n${script.slice(0, 8000)}\n\n`
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

      // Happy path: model returns actual keys.
      if (params.bible.byKey[s]) return s;

      // Common failure: model returns a character NAME instead of the key.
      const byName = nameToKey.get(s.toLowerCase());
      if (byName && params.bible.byKey[byName]) return byName;

      // Tolerate things like "C1:" or "(C1)".
      const keyMatch = s.match(/\b(C\d{1,2})\b/i);
      if (keyMatch) {
        const k = keyMatch[1].toUpperCase();
        if (params.bible.byKey[k]) return k;
      }

      // Fuzzy-ish: if output is "Utbah" and the character name is "Utbah ibn ...".
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

    // Sometimes models respond with JSON.
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

    // Fallback: look for a boolean word in the response.
    if (/\btrue\b/.test(text) || /\byes\b/.test(text)) return true;
    if (/\bfalse\b/.test(text) || /\bno\b/.test(text)) return false;
    return null;
  }

  /**
   * OpenAI classifier #1:
   * Returns true if the SENTENCE (using SCRIPT for pronoun resolution) mentions or refers to:
   * - Allah (or God when clearly used in an Islamic context),
   * - The Prophet Muhammad (incl. “the Prophet”, “Messenger”, “Rasulullah”, etc.),
   * - Any Sahaba / Companions of the Prophet (incl. common names).
   */
  private async sentenceMentionsAllahProphetOrSahaba(params: {
    script?: string | null;
    sentence: string;
    characterBible?: CharacterBible | null;
  }): Promise<{ mentions: boolean; characterKeys: string[] }> {
    const sentence = (params.sentence ?? '').trim();
    if (!sentence) return { mentions: false, characterKeys: [] };

    const script = (params.script ?? '').trim();
    const scriptForContext = script ? script.slice(0, 8000) : '';

    try {
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
              '3) Any Sahaba / Companion of the Prophet\n\n' +
              'Rules:\n' +
              '- Use SCRIPT CONTEXT only to resolve pronouns / references for the TARGET SENTENCE.\n' +
              '- If the sentence is talking about any one but Allah, Any Prophet, Sahaba/Companions, return false.\n' +
              '- If unclear/ambiguous, return false.',
          },
          {
            role: 'user',
            content:
              (scriptForContext
                ? `SCRIPT CONTEXT (for reference resolution):\n${scriptForContext}\n\n`
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
      // Non-fatal: default to false so we don't unexpectedly restrict prompts.
      return { mentions: false, characterKeys: [] };
    }
  }

  /**
   * Returns an async iterable stream of script content chunks from OpenAI.
   */
  async createScriptStream(options: GenerateScriptDto) {
    const subject = options.subject?.trim() || 'religious (Islam)';
    const subjectContent = options.subjectContent?.trim();
    const length = options.length?.trim() || '1 minute';
    const style = options.style?.trim() || 'Conversational';
    const technique = this.normalizeTechnique(options.technique);
    const model = options.model?.trim() || this.model;
    const customSystemPrompt = options.systemPrompt?.trim() || '';
    const wordRange = this.getStrictWordRange(length);
    const haveCustomPrompt = Boolean(customSystemPrompt);
    const referenceScripts = (options.referenceScripts ?? [])
      .map((r) => ({
        id: typeof r?.id === 'string' ? r.id.trim() : '',
        title: typeof r?.title === 'string' ? r.title.trim() : '',
        script: typeof r?.script === 'string' ? r.script.trim() : '',
      }))
      .filter((r) => Boolean(r.script));
    const haveReferences = referenceScripts.length > 0;
    const techniqueBlock = this.getTechniquePromptBlock(technique);

    try {
      const messages: LlmMessage[] = [
        {
          role: 'system',
          content:
            'You are an expert video script writer. ' +
            'You ONLY respond with the script text, no explanations, headings, or markdown. ' +
            'You have a talent for getting straight to the point and engaging the audience quickly. ' +
            'Aim for driving a comment from the viewer. ' +
            `HARD LENGTH CONSTRAINT: Output MUST be between ${wordRange.minWords} and ${wordRange.maxWords} words (target ${wordRange.targetWords}). Count words before responding; if over or under, rewrite until within range.`,
        },
      ];

      if (techniqueBlock) {
        messages.push({
          role: 'system',
          content:
            'Apply the selected narrative technique below while writing. ' +
            'If reference scripts are provided, still apply the technique while matching the reference style.\n\n' +
            techniqueBlock,
        });
      }

      if (haveReferences) {
        messages.push({
          role: 'system',
          content:
            'REFERENCE SCRIPTS MODE: The user provided one or more reference scripts in the conversation history below. ' +
            'Analyze them to infer writing style (voice, pacing, structure, rhythm, hooks, transitions). ' +
            'For this request, IGNORE any style/tone field and IGNORE any writing-goals prompt text. ' +
            'Generate a NEW script that matches the requested subject, subject content, and length constraints, while matching the STYLE of the references. ' +
            'Do NOT mention the reference scripts. Do NOT copy unique facts or reuse long verbatim phrases; only mimic style.',
        });

        referenceScripts.forEach((ref, idx) => {
          const headerParts = [`Reference Script #${idx + 1}`];
          if (ref.title) headerParts.push(`Title: ${ref.title}`);
          if (ref.id) headerParts.push(`Id: ${ref.id}`);

          messages.push({
            role: 'user',
            content:
              `${headerParts.join(' | ')}\n` +
              'Use this script as a STYLE exemplar only.',
          });

          messages.push({
            role: 'assistant',
            content: ref.script,
          });
        });
      }
      messages.push({
        role: 'user',
        content:
          `Generate a detailed video narration script.\n` +
          `Approximate length: ${length}.\n` +
          `Strict word count requirement: ${wordRange.minWords}-${wordRange.maxWords} words (target ${wordRange.targetWords}).\n` +
          `Subject: ${subject}.\n` +
          (subjectContent
            ? `Specific focus on a single story/subject & be creative & not expected in choosing the story/subject within the subject: ${subjectContent}.\n`
            : '') +
          'Write the NEW script in the same narrative style as the reference scripts above.\n' +
          `For religious (Islam) scripts, keep it respectful, authentic, and avoid controversial topics.\n` +
          'Do not include scene directions, only spoken narration.',
      });
      return this.llm.streamText({
        model,
        messages,
        maxTokens: 2500,
      });
    } catch (error) {
      // Surface a clean error to the controller
      throw new InternalServerErrorException('Failed to generate script');
    }
  }

  /**
   * Takes a raw script string and returns an ordered list of short sentences.
   */
  async splitScript(dto: {
    script: string;
    model?: string;
    systemPrompt?: string;
  }): Promise<string[]> {
    try {
      const script = dto.script;
      const model = dto.model?.trim() || this.model;

      const normalizeSentences = (parsed: unknown): string[] => {
        if (Array.isArray(parsed)) {
          return parsed.map((v) => String(v).trim()).filter(Boolean);
        }

        if (parsed && typeof parsed === 'object') {
          const obj = parsed as Record<string, unknown>;

          // Preferred: { "sentences": ["...", "..."] }
          const maybeSentences = obj.sentences;
          if (Array.isArray(maybeSentences)) {
            return maybeSentences.map((v) => String(v).trim()).filter(Boolean);
          }

          // Common failure: {"1":"...","2":"..."}
          // Convert numeric-keyed objects to an ordered array.
          const keys = Object.keys(obj);
          const allNumericKeys =
            keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
          if (allNumericKeys) {
            return keys
              .sort((a, b) => Number(a) - Number(b))
              .map((k) => String(obj[k] ?? '').trim())
              .filter(Boolean);
          }
        }

        return [];
      };

      const requiredSplitterPrompt =
        'You split long scripts into clean sentences. ' +
        'You cannot write any more or less words than the original script. ' +
        'Sentences cannot be too short, it can be long if there is a deep meaning to the sentence. ' +
        'Always respond with pure JSON as an OBJECT with exactly this shape: {"sentences": string[]}. ' +
        'No extra keys. No extra text.';

      const splitterSystemPrompt = [requiredSplitterPrompt]
        .filter(Boolean)
        .join('\n');

      const parsed = await this.llm.completeJson<unknown>({
        model,
        temperature: 0,
        maxTokens: 1500,
        retries: 2,
        messages: [
          {
            role: 'system',
            content: splitterSystemPrompt,
          },
          {
            role: 'user',
            content:
              'Return ONLY valid JSON in this exact shape: {"sentences": ["sentence 1", "sentence 2", ...]}.\n\n' +
              script,
          },
        ],
      });
      const sentences = normalizeSentences(parsed);

      if (!sentences.length) {
        throw new Error('Invalid JSON structure for sentences');
      }

      return sentences;
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to split script into sentences',
      );
    }
  }

  /**
   * Returns an async iterable stream of enhanced script chunks from OpenAI.
   * The model improves clarity, flow, and engagement while preserving
   * meaning, topic, and approximate length.
   */
  async createEnhanceScriptStream(dto: EnhanceScriptDto) {
    const baseScript = dto.script?.trim();
    if (!baseScript) {
      throw new BadRequestException('Script is required for enhancement');
    }

    const length = dto.length?.trim() || '1 minute';
    const style = dto.style?.trim() || 'Conversational';
    const technique = this.normalizeTechnique(dto.technique);
    const model = dto.model?.trim() || this.model;
    const customSystemPrompt = dto.systemPrompt?.trim();
    const wordRange = this.getStrictWordRange(length);

    const techniqueBlock = this.getTechniquePromptBlock(technique);

    const requiredEnhanceRoleLine = 'You are an expert video script editor.';
    const requiredEnhanceOutputOnlyLine =
      'You ONLY respond with the improved script text, no explanations, headings, or markdown.';
    const requiredEnhanceLengthLine =
      `HARD LENGTH CONSTRAINT: Your output MUST be between ${wordRange.minWords} and ${wordRange.maxWords} words (target ${wordRange.targetWords}). ` +
      'Count words before responding; if over or under, rewrite until within range.';

    const enhanceSystemPrompt = [
      customSystemPrompt,
      requiredEnhanceRoleLine,
      'You improve existing narration scripts by enhancing clarity, flow, and emotional impact, while strictly preserving the original meaning, topic, and approximate length.',
      techniqueBlock
        ? 'Also enforce the selected narrative technique below while editing. Integrate it naturally; do not add extra sections.'
        : null,
      techniqueBlock,
      requiredEnhanceOutputOnlyLine,
      requiredEnhanceLengthLine,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      return this.llm.streamText({
        model,
        maxTokens: 2500,
        messages: [
          {
            role: 'system',
            content: enhanceSystemPrompt,
          },
          {
            role: 'user',
            content:
              `Here is a video narration script that needs refinement.\n` +
              `Target approximate length: ${length}.\n` +
              `Strict word count requirement: ${wordRange.minWords}-${wordRange.maxWords} words (target ${wordRange.targetWords}).\n` +
              `Desired style/tone: ${style}.\n` +
              'Improve wording, pacing, and engagement, but do not change the underlying message or topic.\n' +
              'Do not add disclaimers or meta commentary.\n\n' +
              'Original script:\n\n' +
              baseScript,
          },
        ],
      });
    } catch (error) {
      throw new InternalServerErrorException('Failed to enhance script');
    }
  }

  /**
   * Returns an async iterable stream of an enhanced SINGLE sentence.
   * Preserves meaning; improves clarity/flow; outputs only the rewritten sentence.
   */
  async createEnhanceSentenceStream(dto: EnhanceSentenceDto) {
    const baseSentence = dto.sentence?.trim();
    if (!baseSentence) {
      throw new BadRequestException('Sentence is required for enhancement');
    }

    const style = dto.style?.trim() || 'Conversational';
    const technique = this.normalizeTechnique(dto.technique);
    const model = dto.model?.trim() || this.model;
    const customSystemPrompt = dto.systemPrompt?.trim();
    const userPrompt = dto.userPrompt?.trim();

    const techniqueBlock = this.getTechniquePromptBlock(technique);

    const requiredRoleLine =
      'You are an expert editor for short video narration.';
    const requiredOutputOnlyLine =
      'You ONLY respond with the improved sentence text. No quotes, no headings, no markdown, no explanations.';
    const requiredSingleSentenceLine =
      'Return exactly ONE sentence. Do not add a second sentence or bullet points.';

    const systemPrompt = [
      customSystemPrompt,
      requiredRoleLine,
      'You rewrite a single sentence to improve clarity, flow, and engagement while strictly preserving the original meaning and intent.',
      `Desired style/tone: ${style}.`,
      techniqueBlock
        ? 'Also apply the selected narrative technique below when rewriting (without changing meaning).'
        : null,
      techniqueBlock,
      requiredSingleSentenceLine,
      requiredOutputOnlyLine,
    ]
      .filter(Boolean)
      .join('\n');

    const userContent =
      (userPrompt
        ? `User instruction for the rewrite: ${userPrompt}\n\n`
        : '') +
      `Rewrite this sentence (keep meaning; improve wording; keep it one sentence):\n\n${baseSentence}`;

    try {
      return this.llm.streamText({
        model,
        maxTokens: 800,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      });
    } catch (error) {
      throw new InternalServerErrorException('Failed to enhance sentence');
    }
  }

  /**
   * Generates a short, descriptive title for a script.
   */
  async generateTitleForScript(script: string): Promise<string> {
    const trimmed = script?.trim();
    if (!trimmed) {
      return 'Untitled Script';
    }

    try {
      const title = (
        await this.llm.completeText({
          model: this.model,
          maxTokens: 64,
          temperature: 0.4,
          messages: [
            {
              role: 'system',
              content:
                'You create concise, engaging titles for video scripts. ' +
                'Respond with ONLY the title text, no quotes, no extra words.',
            },
            {
              role: 'user',
              content:
                'Generate a short, catchy title (max 8 words) for this script:\n\n' +
                trimmed,
            },
          ],
        })
      )?.trim();
      if (!title) {
        return 'Untitled Script';
      }

      // Enforce a reasonable max length for storage/UI.
      return title.length > 255 ? title.slice(0, 252).trimEnd() + '...' : title;
    } catch (error) {
      return 'Untitled Script';
    }
  }

  async generateYoutubeSeo(script: string): Promise<{
    title: string;
    description: string;
    tags: string[];
  }> {
    const trimmed = script?.trim();
    if (!trimmed) {
      throw new BadRequestException('Script is required');
    }

    let parsed: any;
    try {
      parsed = await this.llm.completeJson<any>({
        model: this.model,
        temperature: 0.2,
        maxTokens: 1200,
        retries: 2,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert YouTube SEO copywriter. ' +
              'Given a video narration script, you produce metadata optimized for search and click-through. ' +
              'Return ONLY valid JSON as: {"title": string, "description": string, "tags": string[]}. ' +
              'Rules: title <= 100 chars, description <= 5000 chars, tags: 10-20 items, each tag <= 30 chars, no emojis. ' +
              'This video is a SHORT: the description MUST start with the exact title on its own line, followed by ONE short sentence on the next line. ' +
              'At the very end of the description, append this exact string: #allah,#islamicShorts,#shorts',
          },
          {
            role: 'user',
            content:
              'Generate YouTube SEO metadata for this video script. ' +
              'The title should be compelling and keyword-rich. ' +
              'The description must follow the SHORT format: title line + one short sentence, then end with the required hashtags. ' +
              'Tags should be relevant and specific (mix broad + long-tail).\n\n' +
              trimmed,
          },
        ],
      });
    } catch {
      throw new InternalServerErrorException('Invalid JSON from the model');
    }

    const title = String(parsed.title ?? '')
      .trim()
      .slice(0, 100);

    const requiredHashtags = '#allah,#shorts';

    const pickShortSentence = (raw: string) => {
      const cleaned = String(raw || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleaned) return 'A quick short with a powerful takeaway.';

      // Take the first sentence-like chunk and keep it short.
      const first = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned;
      const normalized = first.replace(/[\n\r]+/g, ' ').trim();
      if (!normalized) return 'A quick short with a powerful takeaway.';
      const capped =
        normalized.length > 140
          ? normalized.slice(0, 137).trimEnd() + '...'
          : normalized;
      return capped;
    };

    // Always enforce the shorts description format:
    // Title on first line, one short sentence on second line, required hashtags at the very end.
    const modelDesc = String(parsed.description ?? '').trim();
    const secondLine = pickShortSentence(modelDesc);
    const description = `${secondLine}\n\n${requiredHashtags}`.slice(0, 5000);

    const modelTags = Array.isArray(parsed.tags)
      ? parsed.tags
          .map((t: any) => String(t).trim())
          .filter(Boolean)
          .map((t: string) => t.replace(/^#/, ''))
          .map((t: string) => t.toLowerCase())
          .map((t: string) => t.slice(0, 30))
          .slice(0, 25)
      : [];

    const seen = new Set<string>();
    const tags: string[] = ['Allah', 'Shorts', 'Islamic Shorts', 'Muslims'];

    for (const t of modelTags) {
      const cleaned = String(t || '')
        .trim()
        .toLowerCase();
      if (!cleaned) continue;
      const key = cleaned;
      if (seen.has(key)) continue;
      tags.push(cleaned);
      seen.add(key);
      if (tags.length >= 25) break;
    }

    if (!title) {
      throw new InternalServerErrorException('OpenAI returned empty title');
    }

    return {
      title,
      description,
      tags,
    };
  }

  /**
   * Generates a detailed image prompt for a sentence, then generates an image.
   */
  async generateImageForSentence(dto: GenerateImageDto, userId: string) {
    const subject = dto.subject?.trim() || 'religious (Islam)';
    // Force an anime-inspired look by default.
    const style =
      dto.style?.trim() || 'Anime style, detailed, vibrant, high quality';

    const fullScriptContext = dto.script?.trim();

    const frameType: 'single' | 'start' | 'end' =
      dto.frameType === 'start' || dto.frameType === 'end'
        ? dto.frameType
        : 'single';
    const continuityPrompt = dto.continuityPrompt?.trim();

    const sentenceText = (dto.sentence ?? '').trim();
    const sentenceContainsMaleCharacter = (text: string): boolean => {
      const s = (text ?? '').trim();
      if (!s) return false;

      // Heuristic: only triggers when the sentence explicitly suggests a male character.
      // This intentionally stays conservative to avoid injecting random people.
      return (
        /\b(he|him|his|himself)\b/i.test(s) ||
        /\b(man|men|male|boy|father|dad|son|brother|husband|gentleman|king|prince)\b/i.test(
          s,
        )
      );
    };

    const characterBible =
      await this.getOrCreateCharacterBible(fullScriptContext);

    // Classify prohibitions + map referenced characters (if safe).
    const mentionResult = await this.sentenceMentionsAllahProphetOrSahaba({
      script: fullScriptContext,
      sentence: dto.sentence,
      characterBible,
    });
    const mentionsFemale = this.sentenceMentionsFemale(sentenceText);
    const enforceNoHumanFigures = mentionResult.mentions || mentionsFemale;
    const referencedCharacterKeys = enforceNoHumanFigures
      ? []
      : mentionResult.characterKeys;
    const focusMaleCharacter =
      !enforceNoHumanFigures &&
      (sentenceContainsMaleCharacter(sentenceText) ||
        referencedCharacterKeys.length > 0);

    const noHumanFiguresRule =
      'ABSOLUTE RULE: Do NOT depict any humans or human-like figures. ' +
      'NO people, NO faces, NO heads, NO hands, NO bodies, NO skin, NO silhouettes, NO characters, NO crowds, NO humanoid statues.';

    const noWomenRule =
      'ABSOLUTE RULE: Do NOT depict women or female characters. ' +
      'No female faces, no female bodies, no girls, no women, no feminine silhouettes.';

    try {
      let prompt = dto.prompt?.trim();
      if (!prompt) {
        const frameBlock =
          frameType === 'single'
            ? ''
            : (frameType === 'start'
                ? 'FRAME CONTEXT: This image is the START FRAME of the scene for the TARGET SENTENCE. Establish the environment and the beginning of the action. The prompt MUST include the words "START FRAME".'
                : 'FRAME CONTEXT: This image is the END FRAME of the SAME scene for the TARGET SENTENCE. It must be a direct continuation of the START FRAME with the SAME environment/camera/lighting/style; advance the action slightly so the two frames complete each other. The prompt MUST include the words "END FRAME".') +
              (continuityPrompt
                ? `\nCONTINUITY (must match exactly): ${continuityPrompt}`
                : '');

        const characterRefsBlock =
          referencedCharacterKeys.length && characterBible
            ? 'CHARACTER CONSISTENCY (must include these exact attributes in the prompt):\n' +
              referencedCharacterKeys
                .map((k) => {
                  const c = characterBible.byKey[k];
                  return c ? `${c.key}: ${c.description}` : null;
                })
                .filter(Boolean)
                .join('\n') +
              '\n\n'
            : '';

        // First ask the chat model for a detailed image prompt
        prompt =
          (
            await this.llm.completeText({
              model: this.model,
              maxTokens: 250,
              temperature: 0.8,
              messages: [
                {
                  role: 'system',
                  content:
                    'You are a visual prompt engineer for image generation models. ' +
                    'Your prompt MUST visually express that emotion through composition, lighting, color palette, environment, and symbolism. ' +
                    'Make the result composition-rich, varied, imaginative, and cinematic (avoid generic defaults unless the sentence truly calls for it). ' +
                    'use the full script provided ONLY as context to infer time period, cultural details. ' +
                    (frameBlock ? frameBlock + '\n' : '') +
                    noWomenRule +
                    (enforceNoHumanFigures
                      ? noHumanFiguresRule
                      : referencedCharacterKeys.length
                        ? 'You MUST keep character appearance consistent with the provided CHARACTER CONSISTENCY block. Include ONLY the referenced character(s) and explicitly include their facial/physical attributes in the prompt.'
                        : focusMaleCharacter
                          ? 'The sentence includes male character(s). Include the male character(s) implied by the sentence as the focal point, and make the visual center on what they are doing (clear action, posture, props, and environment). Do not add extra characters beyond what the sentence implies.'
                          : 'If the sentence explicitly includes a person, you may depict them; otherwise do not introduce random people.') +
                    'Respond with a single prompt sentence only, describing visuals only.' +
                    'Read the sentence and identify the single most dominant emotion and the most dominant object/action/idea. ',
                },
                {
                  role: 'user',
                  content:
                    (fullScriptContext
                      ? `FULL SCRIPT CONTEXT (use ONLY for era/time):\n${fullScriptContext}\n\n`
                      : '') +
                    characterRefsBlock +
                    (frameBlock ? `${frameBlock}\n\n` : '') +
                    `Sentence: "${dto.sentence}"\n` +
                    `Desired style: ${style} (anime-style artwork).\n\n` +
                    // Safety / theological constraints for religious content
                    'Important constraints:\n' +
                    '- Do not depict women/females.\n' +
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
        // Keep consistency with the app's defaults: encourage anime style.
        const wantsAnime = /anime/i.test(style);
        const hasAnime = /anime/i.test(prompt);
        if (wantsAnime && !hasAnime) {
          prompt = `${prompt}, ${style}`;
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

        // Always enforce: no female depictions.
        const hasNoWomen =
          /\bno\s+(women|woman|girls|girl|female|females)\b|\bno\s+female\s+(faces|bodies|silhouettes)\b/i.test(
            prompt,
          );
        if (!hasNoWomen) {
          prompt = `${prompt}, no women, no girls, no female faces, no female bodies`;
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
          // Inject the character descriptions so the image model keeps the character consistent.
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

      // Decide target aspect ratio / dimensions based on script length.
      // For short scripts (e.g. 30 seconds or 1 minute), prefer a
      // vertical format suitable for reels/shorts. Otherwise use
      // a landscape 16:9.
      const rawLength = dto.scriptLength?.toLowerCase() ?? '';
      const isShortForm =
        typeof dto.isShort === 'boolean'
          ? dto.isShort
          : rawLength.includes('30 second') || rawLength.includes('1 minute');

      // Leonardo requires width/height between 512 and 1536 and multiples of 8.
      // Use sensible defaults that fit reels/shorts vs landscape while
      // respecting these constraints.
      const width = isShortForm ? 768 : 1344; // 9:16 vs ~16:9
      const height = isShortForm ? 1344 : 768;

      // Then generate an image from that prompt using Leonardo AI
      if (!this.leonardoApiKey) {
        throw new InternalServerErrorException(
          'LEONARDO_API_KEY is not configured on the server',
        );
      }

      if (!this.leonardoModelId) {
        throw new InternalServerErrorException(
          'LEONARDO_MODEL_ID is not configured on the server',
        );
      }

      // Step 1: create a generation job
      const createResponse = await fetch(
        'https://cloud.leonardo.ai/api/rest/v1/generations',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.leonardoApiKey}`,
          },
          body: JSON.stringify({
            prompt,
            modelId: this.leonardoModelId,
            width,
            height,
            num_images: 1,
          }),
        } as any,
      );

      if (!createResponse.ok) {
        const errorText = await createResponse.text().catch(() => '');

        console.error('Leonardo create generation failed', {
          status: createResponse.status,
          statusText: createResponse.statusText,
          body: errorText,
        });

        if (createResponse.status === 400) {
          throw new BadRequestException(
            'Invalid request to Leonardo image generation API',
          );
        }

        if (createResponse.status === 401 || createResponse.status === 403) {
          throw new UnauthorizedException(
            'Unauthorized to call Leonardo image generation API',
          );
        }

        throw new InternalServerErrorException(
          'Failed to start image generation using Leonardo',
        );
      }

      const createJson = await createResponse.json();

      const generationId =
        createJson?.sdGenerationJob?.generationId ||
        createJson?.sdGenerationJob?.id ||
        createJson?.generationId ||
        createJson?.id;

      if (!generationId) {
        console.error('Leonardo create generation unexpected response', {
          body: createJson,
        });
        throw new InternalServerErrorException(
          'Leonardo did not return a generation id',
        );
      }

      // Helper to wait between polling attempts
      const delay = (ms: number) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        });

      // Step 2: poll for completion and get the image URL
      let imageUrl: string | undefined;
      const maxAttempts = 30; // ~60 seconds total with 2s interval

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const statusResponse = await fetch(
          `https://cloud.leonardo.ai/api/rest/v1/generations/${generationId}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${this.leonardoApiKey}`,
            },
          } as any,
        );

        if (!statusResponse.ok) {
          const errorText = await statusResponse.text().catch(() => '');

          console.error('Leonardo get generation failed', {
            status: statusResponse.status,
            statusText: statusResponse.statusText,
            body: errorText,
          });
          break;
        }

        const statusJson = await statusResponse.json();

        // Leonardo REST responses typically wrap the generation in `generations_by_pk`
        const generation =
          statusJson?.generations_by_pk ||
          statusJson?.sdGenerationJob ||
          statusJson?.generation ||
          statusJson;

        const status =
          generation?.status || generation?.state || statusJson?.status;

        if (
          status === 'COMPLETE' ||
          status === 'FINISHED' ||
          status === 'succeeded'
        ) {
          const candidateImages =
            generation?.generated_images ||
            generation?.images ||
            statusJson?.generated_images ||
            statusJson?.images;

          if (Array.isArray(candidateImages) && candidateImages.length > 0) {
            imageUrl = candidateImages[0]?.url || candidateImages[0]?.imageUrl;
          }
          break;
        }

        if (status === 'FAILED' || status === 'ERROR') {
          console.error('Leonardo generation failed', {
            body: statusJson,
          });
          break;
        }

        // Still running - wait and poll again

        await delay(2000);
      }

      if (!imageUrl) {
        throw new InternalServerErrorException(
          'Timed out waiting for Leonardo image generation',
        );
      }

      // Step 3: download the image and convert to base64 so the frontend
      // can continue treating it like the previous OpenAI response
      const imgResp = await fetch(imageUrl, {
        method: 'GET',
      } as any);

      if (!imgResp.ok) {
        const errorText = await imgResp.text().catch(() => '');

        console.error('Leonardo image download failed', {
          status: imgResp.status,
          statusText: imgResp.statusText,
          body: errorText,
        });
        throw new InternalServerErrorException(
          'Failed to download Leonardo generated image',
        );
      }

      const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
      const b64 = imgBuffer.toString('base64');

      // Persist the generated image to Cloudinary + DB first.
      // This enables "library" reuse and ensures the render pipeline can use stable URLs.
      const saved = await this.imagesService.saveCompressedToCloudinary({
        buffer: imgBuffer,
        filename: `ai-${Date.now()}.png`,
        user_id: userId,
        image_style: style,
        image_size: isShortForm ? ImageSize.PORTRAIT : ImageSize.LANDSCAPE,
        image_quality: ImageQuality.HIGH,
        prompt,
      });

      return {
        prompt,
        imageBase64: b64,
        imageUrl: saved.image,
        savedImageId: saved.id,
      };
    } catch (error) {
      // The OpenAI SDK throws rich errors (status, error.message, code, etc.).
      // Log details for debugging and map common statuses to clearer HTTP errors.
      const err = error;

      console.error('OpenAI image generation failed', {
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

  /**
   * Generates a voice-over audio file for the given script using ElevenLabs TTS.
   * Returns the raw audio bytes (MP3).
   */
  private mergeSentenceTexts(sentences: string[]): string {
    return (sentences || [])
      .map((s) => (s ?? '').trim())
      .filter(Boolean)
      .map((s) => (/[^\s][.!?]$/.test(s) ? s : `${s}.`))
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  async generateVoiceForSentences(
    sentences: string[],
    voiceId?: string,
    styleInstructions?: string,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const merged = this.mergeSentenceTexts(sentences);
    return this.generateVoiceForScript(merged, voiceId, styleInstructions);
  }

  async generateVoiceForScript(
    script: string,
    voiceId?: string,
    styleInstructions?: string,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const text = script?.trim();
    if (!text) {
      throw new BadRequestException(
        'Script text is required to generate voice',
      );
    }

    const decideProvider = (
      idRaw?: string,
    ): { provider: 'google' | 'elevenlabs'; rawId?: string } => {
      const id = String(idRaw ?? '').trim();
      if (!id) {
        // Default provider preference: Gemini TTS (AI Studio) if configured; otherwise ElevenLabs.
        if ((this.geminiApiKey || '').trim()) {
          return {
            provider: 'google',
            rawId: this.googleTtsDefaultVoiceName?.trim() || undefined,
          };
        }
        return { provider: 'elevenlabs', rawId: this.elevenDefaultVoiceId };
      }

      if (id.startsWith('google:')) {
        return { provider: 'google', rawId: id.slice('google:'.length) };
      }

      if (id.startsWith('elevenlabs:')) {
        return {
          provider: 'elevenlabs',
          rawId: id.slice('elevenlabs:'.length),
        };
      }

      // Backwards compatibility:
      // - Existing ElevenLabs IDs are typically opaque.
      // - Google voice names typically look like: en-US-Studio-O
      if (/^[a-z]{2}-[A-Z]{2}-/u.test(id)) {
        return { provider: 'google', rawId: id };
      }

      return { provider: 'elevenlabs', rawId: id };
    };

    const chosen = decideProvider(voiceId);
    if (chosen.provider === 'google') {
      const voiceName = String(chosen.rawId ?? '').trim();
      if (!voiceName) {
        throw new BadRequestException('voiceId is required for Google TTS');
      }
      const buffer = await this.generateVoiceWithGeminiTts({
        text,
        voiceName,
        styleInstructions,
      });
      return {
        buffer,
        mimeType: 'audio/mpeg',
        filename: 'voice-over.mp3',
      };
    }

    const elevenVoiceId =
      String(chosen.rawId ?? '').trim() || this.elevenDefaultVoiceId;
    const buffer = await this.generateVoiceWithElevenLabs({
      text,
      voiceId: elevenVoiceId,
    });
    return {
      buffer,
      mimeType: 'audio/mpeg',
      filename: 'voice-over.mp3',
    };
  }

  private async generateVoiceWithElevenLabs(params: {
    text: string;
    voiceId: string;
  }): Promise<Buffer> {
    if (!this.elevenApiKey) {
      throw new InternalServerErrorException(
        'ELEVENLABS_API_KEY is not configured on the server',
      );
    }

    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${params.voiceId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
            'xi-api-key': this.elevenApiKey,
          },
          body: JSON.stringify({
            text: params.text,
            model_id: 'eleven_multilingual_v2',
          }),
        } as any,
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');

        console.error('ElevenLabs TTS failed', {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
        });

        if (response.status === 400) {
          throw new BadRequestException(
            'Invalid request to ElevenLabs text-to-speech API',
          );
        }

        if (response.status === 401 || response.status === 403) {
          throw new UnauthorizedException(
            'Unauthorized to call ElevenLabs text-to-speech API',
          );
        }

        throw new InternalServerErrorException(
          'Failed to generate voice using ElevenLabs',
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      const err = error;

      console.error('Error while calling ElevenLabs TTS', {
        message: err?.message,
        stack: err?.stack,
      });
      if (
        err instanceof BadRequestException ||
        err instanceof UnauthorizedException
      ) {
        throw err;
      }
      throw new InternalServerErrorException(
        'Unexpected error while generating voice with ElevenLabs',
      );
    }
  }

  private pcm16leToWav(params: {
    pcm: Buffer;
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
  }): Buffer {
    const { pcm, sampleRate, channels, bitsPerSample } = params;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;

    const dataSize = pcm.length;
    const out = Buffer.allocUnsafe(44 + dataSize);

    out.write('RIFF', 0);
    out.writeUInt32LE(36 + dataSize, 4);
    out.write('WAVE', 8);

    out.write('fmt ', 12);
    out.writeUInt32LE(16, 16); // PCM fmt chunk size
    out.writeUInt16LE(1, 20); // audio format = PCM
    out.writeUInt16LE(channels, 22);
    out.writeUInt32LE(sampleRate, 24);
    out.writeUInt32LE(byteRate, 28);
    out.writeUInt16LE(blockAlign, 32);
    out.writeUInt16LE(bitsPerSample, 34);

    out.write('data', 36);
    out.writeUInt32LE(dataSize, 40);
    pcm.copy(out, 44);
    return out;
  }

  private async pcm16leToMp3Async(params: {
    pcm: Buffer;
    sampleRate: number;
    channels: 1 | 2;
    kbps?: number;
  }): Promise<Buffer> {
    const { pcm, sampleRate, channels, kbps = 128 } = params;

    const installerPath =
      ffmpegInstaller?.path ?? ffmpegInstaller?.default?.path;
    const candidatePath =
      String(installerPath ?? '').trim() ||
      String(ffmpegPath ?? '').trim() ||
      String(process.env.FFMPEG_PATH ?? '').trim() ||
      'ffmpeg';

    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      's16le',
      '-ar',
      String(sampleRate),
      '-ac',
      String(channels),
      '-i',
      'pipe:0',
      '-vn',
      '-acodec',
      'libmp3lame',
      '-b:a',
      `${kbps}k`,
      '-f',
      'mp3',
      'pipe:1',
    ];

    const child = spawn(candidatePath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (d) => stdoutChunks.push(Buffer.from(d)));
    child.stderr.on('data', (d) => stderrChunks.push(Buffer.from(d)));

    child.stdin.end(pcm);

    const exitCode: number = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });

    const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
    if (exitCode !== 0) {
      throw new InternalServerErrorException(
        `ffmpeg failed to encode MP3 (exit ${exitCode})${stderr ? `: ${stderr}` : ''}`,
      );
    }

    const out = Buffer.concat(stdoutChunks);
    if (!out.length) {
      throw new InternalServerErrorException(
        `ffmpeg returned empty MP3 output${stderr ? `: ${stderr}` : ''}`,
      );
    }
    return out;
  }

  private async generateVoiceWithGeminiTts(params: {
    text: string;
    voiceName: string;
    styleInstructions?: string;
  }): Promise<Buffer> {
    if (!this.geminiApiKey) {
      throw new InternalServerErrorException(
        'GEMINI_API_KEY is not configured on the server',
      );
    }

    try {
      const url = new URL(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          this.geminiTtsModel,
        )}:generateContent`,
      );
      url.searchParams.set('key', this.geminiApiKey);

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: (() => {
                    const style = String(params.styleInstructions ?? '').trim();
                    if (!style) return params.text;

                    return (
                      `Style instructions (do NOT speak these instructions): ${style}\n\n` +
                      `Read the following script exactly as written:\n${params.text}`
                    );
                  })(),
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: params.voiceName,
                },
              },
            },
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error('Gemini TTS failed', {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
        });

        if (response.status === 400) {
          throw new BadRequestException('Invalid request to Gemini TTS API');
        }

        if (response.status === 401 || response.status === 403) {
          throw new UnauthorizedException(
            'Unauthorized to call Gemini TTS API',
          );
        }

        throw new InternalServerErrorException(
          'Failed to generate voice using Gemini TTS',
        );
      }

      const json = await response.json();
      const parts =
        json?.candidates?.[0]?.content?.parts &&
        Array.isArray(json.candidates[0].content.parts)
          ? json.candidates[0].content.parts
          : [];

      const audioPart = parts.find((p: any) =>
        Boolean(p?.inlineData?.data || p?.inline_data?.data),
      );
      const b64 = String(
        audioPart?.inlineData?.data ?? audioPart?.inline_data?.data ?? '',
      ).trim();

      if (!b64) {
        throw new InternalServerErrorException(
          'Gemini TTS returned empty audio data',
        );
      }

      const pcm = Buffer.from(b64, 'base64');
      // Gemini TTS currently returns raw PCM (16-bit LE, 24kHz, mono) per docs.
      return await this.pcm16leToMp3Async({
        pcm,
        sampleRate: 24000,
        channels: 1,
        kbps: 128,
      });
    } catch (error) {
      const err = error;

      console.error('Error while calling Gemini TTS', {
        message: err?.message,
        stack: err?.stack,
      });

      if (
        err instanceof BadRequestException ||
        err instanceof UnauthorizedException
      ) {
        throw err;
      }

      throw new InternalServerErrorException(
        'Unexpected error while generating voice with Gemini TTS',
      );
    }
  }
}
