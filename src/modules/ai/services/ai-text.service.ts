import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { GenerateScriptDto } from '../dto/generate-script.dto';
import { EnhanceScriptDto } from '../dto/enhance-script.dto';
import { EnhanceSentenceDto } from '../dto/enhance-sentence.dto';
import { GenerateBulkLookEffectsDto } from '../dto/generate-bulk-look-effects.dto';
import { GenerateBulkMotionEffectsDto } from '../dto/generate-bulk-motion-effects.dto';
import { GenerateMediaSearchTermDto } from '../dto/generate-media-search-term.dto';
import { TranslateDto } from '../dto/translate.dto';
import type { LlmMessage } from '../llm/llm-types';
import { AiRuntimeService } from './ai-runtime.service';
// translate-google is a CommonJS export. This project compiles to CommonJS without
// `esModuleInterop`, so we must import it via `require` to avoid `.default` being undefined.
import translateGoogle = require('translate-google');

@Injectable()
export class AiTextService {
  // Narration pacing assumption (words per minute) used to derive strict word-count targets.
  private readonly narrationWpm = 150;
  private readonly visualEffectOptions = [
    'colorGrading',
    'animatedLighting',
    'glassSubtle',
    'glassReflections',
    'glassStrong',
  ] as const;
  private readonly motionEffectOptions = [
    'slowZoomIn',
    'slowZoomOut',
    'diagonalDrift',
    'cinematicPan',
    'focusShift',
    'parallaxMotion',
    'shakeMicroMotion',
    'splitMotion',
    'rotationDrift',
  ] as const;

  constructor(private readonly runtime: AiRuntimeService) { }

  private get llm() {
    return this.runtime.llm;
  }
  private get model() {
    return this.runtime.model;
  }
  private get cheapModel() {
    return this.runtime.cheapModel;
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

  private parseApproxLengthToSeconds(lengthRaw: string): number | null {
    const s = (lengthRaw || '').toLowerCase().trim();
    if (!s) return null;

    const match = s.match(
      /(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m)\b/,
    );
    if (!match) return null;

    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) return null;

    const unit = match[2];
    const isSeconds = unit.startsWith('s');
    const seconds = isSeconds ? value : value * 60;

    if (seconds < 5) return 5;
    if (seconds > 60 * 30) return 60 * 30;
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
      : this.narrationWpm;

    const tolerance = Math.max(5, Math.round(targetWords * 0.04));
    const minWords = Math.max(10, targetWords - tolerance);
    const maxWords = Math.max(minWords + 1, targetWords + tolerance);

    return { targetWords, minWords, maxWords };
  }

  private clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
  }

  private chunkItemsByBudget<T>(
    items: T[],
    getText: (item: T) => string,
    maxChars = 12000,
    maxItems = 18,
  ): T[][] {
    const chunks: T[][] = [];
    let current: T[] = [];
    let currentChars = 0;

    for (const item of items) {
      const text = getText(item);
      const itemChars = text.length + 2;

      if (current.length > 0 && (current.length >= maxItems || currentChars + itemChars > maxChars)) {
        chunks.push(current);
        current = [];
        currentChars = 0;
      }

      current.push(item);
      currentChars += itemChars;
    }

    if (current.length > 0) chunks.push(current);
    return chunks;
  }

  private normalizeLookSettings(
    value: Record<string, unknown> | null | undefined,
    blurFallback = 0,
  ): Record<string, unknown> {
    return {
      presetKey: 'custom',
      saturation: this.clampNumber(value?.saturation, 0, 2.5, 1),
      contrast: this.clampNumber(value?.contrast, 0, 2.5, 1),
      brightness: this.clampNumber(value?.brightness, 0, 2.5, 1),
      blurPx: this.clampNumber(blurFallback, 0, 20, 0),
      sepia: this.clampNumber(value?.sepia, 0, 1, 0),
      grayscale: this.clampNumber(value?.grayscale, 0, 1, 0),
      hueRotateDeg: this.clampNumber(value?.hueRotateDeg, -180, 180, 0),
      animatedLightingIntensity: this.clampNumber(
        value?.animatedLightingIntensity,
        0,
        1,
        0,
      ),
      glassOverlayOpacity: this.clampNumber(value?.glassOverlayOpacity, 0, 0.4, 0),
    };
  }

  private omitLookBlur(
    value: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> {
    if (!value || typeof value !== 'object') return {};

    const { blurPx: _blurPx, ...rest } = value;
    return rest;
  }

  private normalizeMotionSettings(
    value: Record<string, unknown> | null | undefined,
    speedFallback = 1.2,
  ): Record<string, unknown> {
    const toBoolean = (raw: unknown, fallback = false) =>
      typeof raw === 'boolean' ? raw : fallback;

    return {
      presetKey: 'custom',
      speed: this.clampNumber(value?.speed, 0.5, 2.5, speedFallback),
      startScale: this.clampNumber(value?.startScale, 0.5, 2, 1),
      endScale: this.clampNumber(value?.endScale, 0.5, 2, 1.055),
      scaleEndNoLimit: toBoolean(value?.scaleEndNoLimit, true),
      translateXStart: this.clampNumber(value?.translateXStart, -20, 20, 0),
      translateXEnd: this.clampNumber(value?.translateXEnd, -20, 20, 0),
      translateXEndNoLimit: toBoolean(value?.translateXEndNoLimit, true),
      translateYStart: this.clampNumber(value?.translateYStart, -20, 20, 0),
      translateYEnd: this.clampNumber(value?.translateYEnd, -20, 20, 0),
      translateYEndNoLimit: toBoolean(value?.translateYEndNoLimit, true),
      rotateStart: this.clampNumber(value?.rotateStart, -10, 10, 0),
      rotateEnd: this.clampNumber(value?.rotateEnd, -10, 10, 0),
      rotateEndNoLimit: toBoolean(value?.rotateEndNoLimit, true),
      originX: this.clampNumber(value?.originX, 0, 100, 50),
      originY: this.clampNumber(value?.originY, 0, 100, 50),
    };
  }

  async generateBulkLookEffects(
    dto: GenerateBulkLookEffectsDto,
  ): Promise<{
    items: Array<{
      sentenceId: string;
      index: number;
      visualEffect:
        | 'colorGrading'
        | 'animatedLighting'
        | 'glassSubtle'
        | 'glassReflections'
        | 'glassStrong';
      imageFilterSettings: Record<string, unknown>;
    }>;
  }> {
    const sentences = Array.isArray(dto?.sentences)
      ? dto.sentences
          .map((item) => ({
            index: Number(item?.index),
            sentenceId: String(item?.sentenceId ?? '').trim(),
            imagePrompt: String(item?.imagePrompt ?? '').trim(),
            visualEffect: item?.visualEffect ?? null,
            imageFilterSettings:
              item?.imageFilterSettings && typeof item.imageFilterSettings === 'object'
                ? item.imageFilterSettings
                : null,
          }))
          .filter(
            (item) =>
              Number.isFinite(item.index) && item.sentenceId.length > 0 && item.imagePrompt.length > 0,
          )
      : [];

    if (!sentences.length) {
      throw new BadRequestException('At least one eligible sentence is required');
    }

    const model = dto.model?.trim() || this.cheapModel;
    const customSystemPrompt = dto.systemPrompt?.trim();
    const chunks = this.chunkItemsByBudget(
      sentences,
      (item) => `${item.index}|${item.sentenceId}|${item.imagePrompt}`,
      12000,
      16,
    );

    const systemPrompt = [
      customSystemPrompt,
      'You are an AI art director creating RANDOM but tasteful LOOK effects for already-generated images.',
      'Always respond with pure JSON as an OBJECT with exactly this shape: {"items": [{"sentenceId": string, "index": number, "visualEffect": string, "imageFilterSettings": object}]}',
      'Rules:',
      `- visualEffect must be one of: ${this.visualEffectOptions.join(', ')}.`,
      '- Return exactly one item for each provided image.',
      '- Each image should get a fitting but varied random look. Do not make all images identical.',
      '- Work only from the image prompt and any current look values provided.',
      '- imageFilterSettings must contain only editable numeric tuning values for the selected look and presetKey="custom".',
      '- Never include blurPx in imageFilterSettings. Blur is locked and must stay unchanged.',
      '- Do not return imagePrompt or extra keys.',
      '- No prose. No markdown. JSON only.',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const chunkResults = await Promise.all(
        chunks.map(async (chunk) => {
          try {
            const parsed = await this.llm.completeJson<{
              items?: Array<{
                sentenceId?: unknown;
                index?: unknown;
                visualEffect?: unknown;
                imageFilterSettings?: unknown;
              }>;
            }>({
              model,
              retries: 2,
              messages: [
                { role: 'system', content: systemPrompt },
                {
                  role: 'user',
                  content:
                    'Return ONLY valid JSON in this exact shape: {"items":[{"sentenceId":"...","index":0,"visualEffect":"colorGrading","imageFilterSettings":{"presetKey":"custom"}}]}\n\n' +
                    'TARGET IMAGES:\n' +
                    chunk
                      .map(
                        (item) =>
                          `- index=${item.index}; sentenceId=${item.sentenceId}; currentVisualEffect=${item.visualEffect ?? 'none'}; currentSettings=${JSON.stringify(this.omitLookBlur(item.imageFilterSettings))}; imagePrompt=${JSON.stringify(item.imagePrompt)}`,
                      )
                      .join('\n'),
                },
              ],
            });

            const bySentenceId = new Map(chunk.map((item) => [item.sentenceId, item]));

            return (Array.isArray(parsed?.items) ? parsed.items : [])
              .map((item) => {
                const sentenceId = String(item?.sentenceId ?? '').trim();
                const source = bySentenceId.get(sentenceId);
                const visualEffect = this.visualEffectOptions.find(
                  (value) => value === item?.visualEffect,
                );

                if (!source || !visualEffect) return null;

                return {
                  sentenceId: source.sentenceId,
                  index: source.index,
                  visualEffect,
                  imageFilterSettings: this.normalizeLookSettings(
                    item?.imageFilterSettings as Record<string, unknown> | null | undefined,
                    this.clampNumber(source.imageFilterSettings?.blurPx, 0, 20, 0),
                  ),
                };
              })
              .filter(Boolean) as Array<{
              sentenceId: string;
              index: number;
              visualEffect:
                | 'colorGrading'
                | 'animatedLighting'
                | 'glassSubtle'
                | 'glassReflections'
                | 'glassStrong';
              imageFilterSettings: Record<string, unknown>;
            }>;
          } catch (error) {
            console.warn('generateBulkLookEffects chunk fallback:', error);
            return [];
          }
        }),
      );

      return { items: chunkResults.flat() };
    } catch (error) {
      console.error('Failed to generate bulk look effects:', error);
      throw new InternalServerErrorException('Failed to generate bulk look effects');
    }
  }

  async generateBulkMotionEffects(
    dto: GenerateBulkMotionEffectsDto,
  ): Promise<{
    items: Array<{
      sentenceId: string;
      index: number;
      imageMotionEffect:
        | 'slowZoomIn'
        | 'slowZoomOut'
        | 'diagonalDrift'
        | 'cinematicPan'
        | 'focusShift'
        | 'parallaxMotion'
        | 'shakeMicroMotion'
        | 'splitMotion'
        | 'rotationDrift';
      imageMotionSettings: Record<string, unknown>;
    }>;
  }> {
    const sentences = Array.isArray(dto?.sentences)
      ? dto.sentences
          .map((item) => ({
            index: Number(item?.index),
            sentenceId: String(item?.sentenceId ?? '').trim(),
            imagePrompt: String(item?.imagePrompt ?? '').trim(),
            imageMotionEffect: item?.imageMotionEffect ?? null,
            imageMotionSpeed: this.clampNumber(item?.imageMotionSpeed, 0.5, 2.5, 1.2),
            imageMotionSettings:
              item?.imageMotionSettings && typeof item.imageMotionSettings === 'object'
                ? item.imageMotionSettings
                : null,
          }))
          .filter(
            (item) =>
              Number.isFinite(item.index) && item.sentenceId.length > 0 && item.imagePrompt.length > 0,
          )
      : [];

    if (!sentences.length) {
      throw new BadRequestException('At least one eligible sentence is required');
    }

    const model = dto.model?.trim() || this.cheapModel;
    const customSystemPrompt = dto.systemPrompt?.trim();
    const chunks = this.chunkItemsByBudget(
      sentences,
      (item) => `${item.index}|${item.sentenceId}|${item.imagePrompt}`,
      12000,
      16,
    );

    const systemPrompt = [
      customSystemPrompt,
      'You are an AI motion director creating RANDOM but tasteful camera-like MOTION effects for already-generated still images.',
      'Always respond with pure JSON as an OBJECT with exactly this shape: {"items": [{"sentenceId": string, "index": number, "imageMotionEffect": string, "imageMotionSettings": object}]}',
      'Rules:',
      `- imageMotionEffect must be one of: ${this.motionEffectOptions.join(', ')}.`,
      '- Return exactly one item for each provided image.',
      '- Each image should get a fitting but varied random motion style. Do not make all images identical.',
      '- Work only from the image prompt and any current motion values provided.',
      '- IMPORTANT: Keep the currentMotionSpeed exactly unchanged. Do NOT return a new speed and do NOT encode a different speed in imageMotionSettings.speed.',
      '- imageMotionSettings must contain only numeric/boolean tuning values and presetKey="custom".',
      '- Do not return imagePrompt or extra keys.',
      '- No prose. No markdown. JSON only.',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const chunkResults = await Promise.all(
        chunks.map(async (chunk) => {
          try {
            const parsed = await this.llm.completeJson<{
              items?: Array<{
                sentenceId?: unknown;
                index?: unknown;
                imageMotionEffect?: unknown;
                imageMotionSettings?: unknown;
              }>;
            }>({
              model,
              retries: 2,
              messages: [
                { role: 'system', content: systemPrompt },
                {
                  role: 'user',
                  content:
                    'Return ONLY valid JSON in this exact shape: {"items":[{"sentenceId":"...","index":0,"imageMotionEffect":"slowZoomIn","imageMotionSettings":{"presetKey":"custom"}}]}\n\n' +
                    'TARGET IMAGES:\n' +
                    chunk
                      .map(
                        (item) =>
                          `- index=${item.index}; sentenceId=${item.sentenceId}; currentMotionEffect=${item.imageMotionEffect ?? 'default'}; currentMotionSpeed=${item.imageMotionSpeed}; currentSettings=${JSON.stringify(item.imageMotionSettings ?? {})}; imagePrompt=${JSON.stringify(item.imagePrompt)}`,
                      )
                      .join('\n'),
                },
              ],
            });

            const bySentenceId = new Map(chunk.map((item) => [item.sentenceId, item]));

            return (Array.isArray(parsed?.items) ? parsed.items : [])
              .map((item) => {
                const sentenceId = String(item?.sentenceId ?? '').trim();
                const source = bySentenceId.get(sentenceId);
                const imageMotionEffect = this.motionEffectOptions.find(
                  (value) => value === item?.imageMotionEffect,
                );

                if (!source || !imageMotionEffect) return null;

                return {
                  sentenceId: source.sentenceId,
                  index: source.index,
                  imageMotionEffect,
                  imageMotionSettings: this.normalizeMotionSettings(
                    item?.imageMotionSettings as Record<string, unknown> | null | undefined,
                    source.imageMotionSpeed,
                  ),
                };
              })
              .filter(Boolean) as Array<{
              sentenceId: string;
              index: number;
              imageMotionEffect:
                | 'slowZoomIn'
                | 'slowZoomOut'
                | 'diagonalDrift'
                | 'cinematicPan'
                | 'focusShift'
                | 'parallaxMotion'
                | 'shakeMicroMotion'
                | 'splitMotion'
                | 'rotationDrift';
              imageMotionSettings: Record<string, unknown>;
            }>;
          } catch (error) {
            console.warn('generateBulkMotionEffects chunk fallback:', error);
            return [];
          }
        }),
      );

      return { items: chunkResults.flat() };
    } catch (error) {
      console.error('Failed to generate bulk motion effects:', error);
      throw new InternalServerErrorException('Failed to generate bulk motion effects');
    }
  }

  async createScriptStream(options: GenerateScriptDto) {
    const subject = options.subject?.trim() || 'religious (Islam)';
    const subjectContent = options.subjectContent?.trim();
    const length = options.length?.trim() || '1 minute';
    const style = options.style?.trim() || 'Conversational';
    const technique = this.normalizeTechnique(options.technique);
    const languageCode = String(options.language ?? '').trim() || 'en';
    const model = options.model?.trim() || this.model;
    const customSystemPrompt = options.systemPrompt?.trim() || '';
    const wordRange = this.getStrictWordRange(length);

    const languageDesc = (() => {
      const code = languageCode;
      switch (code.toLowerCase()) {
        case 'en':
          return 'English (en)';
        case 'ar':
          return 'Arabic (ar)';
        case 'fr':
          return 'French (fr)';
        case 'es':
          return 'Spanish (es)';
        case 'de':
          return 'German (de)';
        case 'it':
          return 'Italian (it)';
        case 'pt':
          return 'Portuguese (pt)';
        case 'ru':
          return 'Russian (ru)';
        case 'tr':
          return 'Turkish (tr)';
        case 'hi':
          return 'Hindi (hi)';
        case 'ur':
          return 'Urdu (ur)';
        case 'id':
          return 'Indonesian (id)';
        case 'ja':
          return 'Japanese (ja)';
        case 'ko':
          return 'Korean (ko)';
        case 'zh-cn':
        case 'zh':
          return 'Chinese (Simplified) (zh-CN)';
        default:
          return `${code} (target language code)`;
      }
    })();

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
            `HARD LENGTH CONSTRAINT: Output MUST be between ${wordRange.minWords} and ${wordRange.maxWords} words (target ${wordRange.targetWords}). Count words before responding; if over or under, rewrite until within range.\n` +
            `LANGUAGE REQUIREMENT: Write the entire script in ${languageDesc}. Do NOT mix languages.`,
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

          messages.push({ role: 'assistant', content: ref.script });
        });
      }

      messages.push({
        role: 'user',
        content:
          `Generate a detailed video narration script.\n` +
          `Approximate length: ${length}.\n` +
          `Strict word count requirement: ${wordRange.minWords}-${wordRange.maxWords} words (target ${wordRange.targetWords}).\n` +
          `Language: ${languageDesc}.\n` +
          `Subject: ${subject}.\n` +
          (subjectContent
            ? `Specific focus on a single story/subject & be creative & not expected in choosing the story/subject within the subject: ${subjectContent}.\n`
            : '') +
          'Write the NEW script in the same narrative style as the reference scripts above.\n' +
          `For religious (Islam) scripts, keep it respectful, authentic, and avoid controversial topics.\n` +
          'Do not include scene directions, only spoken narration.',
      });

      return this.llm.streamText({ model, messages, maxTokens: 2500 });
    } catch {
      throw new InternalServerErrorException('Failed to generate script');
    }
  }

  async splitScript(dto: {
    script: string;
    model?: string;
    systemPrompt?: string;
  }): Promise<{
    sentences: Array<{
      id: string;
      index: number;
      text: string;
      characterKeys: string[];
      locationKey: string | null;
    }>;
    characters: Array<{
      key: string;
      name: string;
      description: string;
      isSahaba: boolean;
      isProphet: boolean;
      isWoman: boolean;
    }>;
    locations: Array<{
      key: string;
      name: string;
      description?: string;
    }>;
  }> {
    try {
      const script = String(dto.script ?? '').trim();
      if (!script) {
        throw new BadRequestException('script is required');
      }

      const model = dto.model?.trim() || this.model;

      type ScriptCharacter = {
        key: string;
        name: string;
        description: string;
        isSahaba: boolean;
        isProphet: boolean;
        isWoman: boolean;
      };

      type ScriptLocation = {
        key: string;
        name: string;
        description?: string;
      };

      type TaggedSentence = {
        text: string;
        characterKeys: string[];
        locationKey: string | null;
      };

      type SplitSentenceRecord = TaggedSentence & {
        id: string;
        index: number;
        normalizedText: string;
      };

      const normalizeWhitespace = (value: string): string =>
        value.replace(/\s+/gu, ' ').trim();

      const normalizeSentenceIdentity = (value: string): string =>
        normalizeWhitespace(value)
          .toLowerCase()
          .replace(/[.!?]+$/gu, '')
          .replace(/["'()[\]{}]/gu, '')
          .trim();

      const buildSentenceStableId = (text: string, index: number): string => {
        const source =
          normalizeSentenceIdentity(text) ||
          normalizeWhitespace(text).toLowerCase();
        const fingerprint = createHash('sha1')
          .update(source || `sentence-${index + 1}`)
          .digest('hex')
          .slice(0, 12);

        return `split-s${index + 1}-${fingerprint}`;
      };

      const finalizeTaggedSentences = (
        items: TaggedSentence[],
      ): SplitSentenceRecord[] => {
        const out: SplitSentenceRecord[] = [];
        let previousNormalizedText: string | null = null;

        for (const item of items) {
          const text = String(item?.text ?? '').trim();
          if (!text) continue;

          const normalizedText =
            normalizeSentenceIdentity(text) ||
            normalizeWhitespace(text).toLowerCase();
          if (!normalizedText) continue;

          // Guard against chunk-boundary duplication without removing intentional repeats.
          if (normalizedText === previousNormalizedText) {
            continue;
          }

          const index = out.length;
          out.push({
            id: buildSentenceStableId(text, index),
            index,
            text,
            characterKeys: Array.from(
              new Set(
                (Array.isArray(item?.characterKeys) ? item.characterKeys : [])
                  .map((key) =>
                    String(key ?? '')
                      .trim()
                      .toUpperCase(),
                  )
                  .filter(Boolean),
              ),
            ),
            locationKey:
              item?.locationKey === null
                ? null
                : String(item?.locationKey ?? '')
                  .trim()
                  .toUpperCase() || null,
            normalizedText,
          });
          previousNormalizedText = normalizedText;
        }

        return out;
      };

      const toSplitSentenceResponse = (records: SplitSentenceRecord[]) =>
        records.map(
          ({ normalizedText: _normalizedText, ...sentence }) => sentence,
        );

      const buildSentenceRecords = (texts: string[]): SplitSentenceRecord[] =>
        finalizeTaggedSentences(
          texts.map((text) => ({
            text,
            characterKeys: [],
            locationKey: null,
          })),
        );

      const countWords = (value: string): number =>
        value.trim().split(/\s+/u).filter(Boolean).length;

      const estimateScriptSeconds = (value: string): number =>
        Math.max(1, Math.round((countWords(value) * 60) / this.narrationWpm));

      const estimatedScriptSeconds = estimateScriptSeconds(script);
      const isLongFormScript =
        estimatedScriptSeconds > 70 || script.length > 3500;
      const sentenceMaxChars = isLongFormScript ? 560 : 320;

      const splitLongSentence = (value: string, maxChars = 320): string[] => {
        const text = value.trim();
        if (!text) return [];
        if (text.length <= maxChars) return [text];

        const out: string[] = [];
        let remaining = text;

        while (remaining.length > maxChars) {
          let cutIndex = remaining.lastIndexOf(' ', maxChars);
          if (cutIndex < Math.floor(maxChars * 0.6)) {
            const forwardCut = remaining.indexOf(' ', maxChars);
            cutIndex = forwardCut === -1 ? maxChars : forwardCut;
          }

          const segment = remaining.slice(0, cutIndex).trim();
          if (segment) out.push(segment);
          remaining = remaining.slice(cutIndex).trim();
        }

        if (remaining) out.push(remaining);
        return out;
      };

      const splitScriptVerbatim = (value: string): string[] => {
        const normalized = value.replace(/\r\n?/gu, '\n').trim();
        if (!normalized) return [];

        const blocks = normalized
          .split(/\n+/u)
          .map((block) => block.trim())
          .filter(Boolean);

        const sentenceRegex = /[^.!?\n]+(?:[.!?]+(?:["')\]]+)?(?=\s|$)|$)/gu;
        const out: string[] = [];

        for (const block of blocks) {
          const matches = block.match(sentenceRegex) ?? [block];
          for (const match of matches) {
            const candidate = match.trim();
            if (!candidate) continue;

            const parts = splitLongSentence(candidate, sentenceMaxChars);
            for (const part of parts) {
              const cleaned = part.trim();
              if (cleaned) out.push(cleaned);
            }
          }
        }

        return out;
      };

      const splitLongBlockAtBoundary = (
        value: string,
        maxChars = 5000,
      ): string[] => {
        const text = value.trim();
        if (!text) return [];
        if (text.length <= maxChars) return [text];

        const out: string[] = [];
        let remaining = text;

        while (remaining.length > maxChars) {
          const slice = remaining.slice(0, maxChars + 1);
          let cutIndex = Math.max(
            slice.lastIndexOf('. '),
            slice.lastIndexOf('! '),
            slice.lastIndexOf('? '),
            slice.lastIndexOf('.\n'),
            slice.lastIndexOf('!\n'),
            slice.lastIndexOf('?\n'),
          );

          if (cutIndex >= 0) {
            cutIndex += 1;
          }

          if (cutIndex < Math.floor(maxChars * 0.55)) {
            cutIndex = slice.lastIndexOf('\n', maxChars);
          }

          if (cutIndex < Math.floor(maxChars * 0.55)) {
            cutIndex = slice.lastIndexOf(' ', maxChars);
          }

          if (cutIndex < Math.floor(maxChars * 0.55)) {
            cutIndex = maxChars;
          }

          const part = remaining.slice(0, cutIndex).trim();
          if (part) out.push(part);
          remaining = remaining.slice(cutIndex).trim();
        }

        if (remaining) out.push(remaining);
        return out;
      };

      const chunkTextBlocks = (
        blocks: string[],
        maxChars = 5000,
        maxItems = 12,
      ): string[] => {
        const normalizedBlocks = blocks
          .map((block) => block.trim())
          .filter(Boolean)
          .flatMap((block) => splitLongBlockAtBoundary(block, maxChars));

        if (!normalizedBlocks.length) return [];

        const segments: string[] = [];
        let current: string[] = [];
        let currentLength = 0;

        for (const block of normalizedBlocks) {
          const separatorLength = current.length > 0 ? 2 : 0;
          const nextLength = currentLength + separatorLength + block.length;

          if (
            current.length > 0 &&
            (current.length >= maxItems || nextLength > maxChars)
          ) {
            segments.push(current.join('\n\n'));
            current = [block];
            currentLength = block.length;
            continue;
          }

          current.push(block);
          currentLength = nextLength;
        }

        if (current.length > 0) {
          segments.push(current.join('\n\n'));
        }

        return segments;
      };

      const splitScriptIntoLlmSegments = (
        value: string,
        maxChars = 5000,
        maxItems = 12,
      ): string[] => {
        const normalized = value.replace(/\r\n?/gu, '\n').trim();
        if (!normalized) return [];

        const paragraphBlocks = normalized
          .split(/\n{2,}/u)
          .map((block) => block.trim())
          .filter(Boolean);

        const sourceBlocks = paragraphBlocks.length
          ? paragraphBlocks
          : [normalized];
        return chunkTextBlocks(sourceBlocks, maxChars, maxItems);
      };

      const chunkSentenceRecords = (
        sentences: SplitSentenceRecord[],
        maxChars = 5000,
        maxItems = 18,
      ): Array<{ start: number; items: SplitSentenceRecord[] }> => {
        const chunks: Array<{ start: number; items: SplitSentenceRecord[] }> =
          [];
        let start = 0;

        while (start < sentences.length) {
          const items: SplitSentenceRecord[] = [];
          let length = 0;
          let cursor = start;

          while (cursor < sentences.length) {
            const candidate = sentences[cursor];
            const nextLength = length + candidate.text.length + 8;
            if (
              items.length > 0 &&
              (items.length >= maxItems || nextLength > maxChars)
            ) {
              break;
            }

            items.push(candidate);
            length = nextLength;
            cursor += 1;
          }

          if (items.length === 0) {
            items.push(sentences[start]);
            cursor = start + 1;
          }

          chunks.push({ start, items });
          start = cursor;
        }

        return chunks;
      };

      const normalizeSentenceItems = (
        parsed: unknown,
        validCharacterKeys: Set<string>,
        validLocationKeys: Set<string>,
      ): Array<{
        text: string;
        characterKeys: string[];
        locationKey: string | null;
      }> => {
        const raw =
          parsed &&
            typeof parsed === 'object' &&
            Array.isArray((parsed as any).sentences)
            ? ((parsed as any).sentences as unknown[])
            : [];

        const out: Array<{
          text: string;
          characterKeys: string[];
          locationKey: string | null;
        }> = [];

        for (const item of raw) {
          if (!item || typeof item !== 'object') continue;
          const text = String((item as any).text ?? '').trim();
          if (!text) continue;

          const rawKeys = Array.isArray((item as any).characterKeys)
            ? ((item as any).characterKeys as unknown[])
            : [];
          const characterKeys = Array.from(
            new Set(
              rawKeys
                .map((k) =>
                  String(k ?? '')
                    .trim()
                    .toUpperCase(),
                )
                .filter(Boolean)
                .filter((k) => validCharacterKeys.has(k)),
            ),
          );

          const locationKeyRaw = String((item as any).locationKey ?? '')
            .trim()
            .toUpperCase();
          const locationKey =
            locationKeyRaw && validLocationKeys.has(locationKeyRaw)
              ? locationKeyRaw
              : null;

          out.push({ text, characterKeys, locationKey });
        }

        return out;
      };

      const normalizeSplitSentenceTexts = (parsed: unknown): string[] => {
        const raw =
          parsed && typeof parsed === 'object'
            ? Array.isArray((parsed as any).sentences)
              ? ((parsed as any).sentences as unknown[])
              : []
            : [];

        const out: string[] = [];

        for (const item of raw) {
          const text =
            typeof item === 'string'
              ? item.trim()
              : item && typeof item === 'object'
                ? String((item as any).text ?? '').trim()
                : '';
          if (!text) continue;
          out.push(text);
        }

        return out;
      };

      const normalizeTaggedSentenceChunk = (
        parsed: unknown,
        texts: string[],
        validCharacterKeys: Set<string>,
        validLocationKeys: Set<string>,
      ): Array<{
        text: string;
        characterKeys: string[];
        locationKey: string | null;
      }> => {
        const raw =
          parsed && typeof parsed === 'object'
            ? Array.isArray((parsed as any).items)
              ? ((parsed as any).items as unknown[])
              : Array.isArray((parsed as any).sentences)
                ? ((parsed as any).sentences as unknown[])
                : []
            : [];

        const byIndex = new Map<
          number,
          { characterKeys: string[]; locationKey: string | null }
        >();

        for (const item of raw) {
          if (!item || typeof item !== 'object') continue;

          const index = Number((item as any).index);
          if (!Number.isInteger(index) || index < 0 || index >= texts.length) {
            continue;
          }

          const rawKeys = Array.isArray((item as any).characterKeys)
            ? ((item as any).characterKeys as unknown[])
            : [];
          const characterKeys = Array.from(
            new Set(
              rawKeys
                .map((key) =>
                  String(key ?? '')
                    .trim()
                    .toUpperCase(),
                )
                .filter(Boolean)
                .filter((key) => validCharacterKeys.has(key)),
            ),
          );

          const locationKeyRaw = String((item as any).locationKey ?? '')
            .trim()
            .toUpperCase();
          const locationKey =
            locationKeyRaw && validLocationKeys.has(locationKeyRaw)
              ? locationKeyRaw
              : null;

          byIndex.set(index, { characterKeys, locationKey });
        }

        return texts.map((text, index) => ({
          text,
          characterKeys: byIndex.get(index)?.characterKeys ?? [],
          locationKey: byIndex.get(index)?.locationKey ?? null,
        }));
      };

      const normalizeCharacters = (parsed: unknown): ScriptCharacter[] => {
        const raw =
          parsed &&
            typeof parsed === 'object' &&
            Array.isArray((parsed as any).characters)
            ? ((parsed as any).characters as unknown[])
            : [];

        const out: ScriptCharacter[] = [];
        const usedKeys = new Set<string>();

        const coerceBool = (v: any): boolean => {
          if (typeof v === 'boolean') return v;
          const s = String(v ?? '')
            .trim()
            .toLowerCase();
          return s === 'true' || s === 'yes' || s === '1';
        };

        for (let i = 0; i < raw.length; i += 1) {
          const c: any = raw[i] ?? {};
          const keyRaw = String(c?.key ?? `C${i + 1}`).trim();
          const key = (keyRaw || `C${i + 1}`).toUpperCase();
          if (!key || usedKeys.has(key)) continue;
          if (!/^C\d+$/i.test(key)) continue;
          if (key === 'C0') continue;

          const name = String(c?.name ?? '').trim() || key;
          const description = String(c?.description ?? '').trim();
          if (!description) continue;

          out.push({
            key,
            name,
            description,
            isSahaba: coerceBool(c?.isSahaba),
            isProphet: coerceBool(c?.isProphet),
            isWoman: coerceBool(c?.isWoman),
          });
          usedKeys.add(key);
          if (out.length >= 16) break;
        }

        return out;
      };

      const normalizeLocations = (parsed: unknown): ScriptLocation[] => {
        const raw =
          parsed &&
            typeof parsed === 'object' &&
            Array.isArray((parsed as any).locations)
            ? ((parsed as any).locations as unknown[])
            : [];

        const out: ScriptLocation[] = [];
        const usedKeys = new Set<string>();

        for (let i = 0; i < raw.length; i += 1) {
          const e: any = raw[i] ?? {};
          const key = String(e?.key ?? '')
            .trim()
            .toUpperCase();
          if (!key || usedKeys.has(key)) continue;
          if (!/^E\d+$/i.test(key)) continue;
          if (key === 'E0') continue;

          const name = String(e?.name ?? '').trim();
          if (!name) continue;

          const description = String(e?.description ?? '').trim();

          out.push({
            key,
            name,
            description: description || undefined,
          });
          usedKeys.add(key);
          if (out.length >= 16) break;
        }

        return out;
      };

      const dedupeCharacters = (
        candidates: ScriptCharacter[],
      ): ScriptCharacter[] => {
        const seen = new Set<string>();
        const out: ScriptCharacter[] = [];

        for (const candidate of candidates) {
          const name = String(candidate?.name ?? '').trim();
          const description = String(candidate?.description ?? '').trim();
          if (!name || !description) continue;

          const identity = normalizeWhitespace(name).toLowerCase();
          if (!identity || seen.has(identity)) continue;

          out.push({
            key: `C${out.length + 1}`,
            name,
            description,
            isSahaba: Boolean(candidate?.isSahaba),
            isProphet: Boolean(candidate?.isProphet),
            isWoman: Boolean(candidate?.isWoman),
          });
          seen.add(identity);

          if (out.length >= 16) break;
        }

        return out;
      };

      const dedupeLocations = (
        candidates: ScriptLocation[],
      ): ScriptLocation[] => {
        const seen = new Set<string>();
        const out: ScriptLocation[] = [];

        for (const candidate of candidates) {
          const name = String(candidate?.name ?? '').trim();
          if (!name) continue;

          const identity = normalizeWhitespace(name).toLowerCase();
          if (!identity || seen.has(identity)) continue;

          const description = String(candidate?.description ?? '').trim();
          out.push({
            key: `E${out.length + 1}`,
            name,
            description: description || undefined,
          });
          seen.add(identity);

          if (out.length >= 16) break;
        }

        return out;
      };

      const requiredCharactersPrompt =
        'You extract canonical CHARACTERS from a narration script for consistent scene depiction.\n' +
        'Always respond with pure JSON as an OBJECT with exactly this shape: ' +
        '{"characters": [{"key": string, "name": string, "description": string, "isSahaba": boolean, "isProphet": boolean, "isWoman": boolean}]}\n\n' +
        'Rules:\n' +
        '- Include ONLY people/human characters that could be visually depicted.\n' +
        '- If the script includes a battle/fight/combat scene, represent each SIDE as a SINGLE GROUP character entry (e.g., "Muslim army", "Opposing army", "Enemy army"). The group description MUST clearly depict a large crowd (many people) to sell the battle scale: formation, density, mixed armor/clothing, banners, dust, movement, silhouettes.\n' +
        '- If the army is the Muslim Army make sure to make their faces covered with cloth (e.g. keffiyeh) to avoid any depiction of facial features for the soldiers, to keep it respectful and in line with common Islamic art conventions.\n' +
        '- Do NOT include Allah/God as a character.\n' +
        '- If the script mentions Sahaba (companions of Prophet Muhammad), still extract them but set the boolean flags accordingly.\n' +
        '- Each character.description MUST be only two lines max & include facial + physical attributes for consistency.\n' +
        '- For any character with isProphet=true: DO NOT describe face details. Write the description to be safe for a BACK VIEW depiction only using only physique + clothing and skin color.\n' +
        '- For any character with isSahaba=true (except an Army): DO NOT describe face details (no eyes/nose/mouth). Write the description to be safe for a BACK VIEW depiction only using physique + clothing and skin color.\n' +
        '- Character keys must be short like C1, C2, C3... in first-appearance order.\n' +
        '- If unsure about any boolean flag, set it to false.\n' +
        '- Each description needs to be one line max\n' +
        '- No extra keys. No extra text.';

      const extractionSegments = splitScriptIntoLlmSegments(script, 12000, 24);

      const extractCharactersFromSegment = async (
        segment: string,
      ): Promise<ScriptCharacter[]> => {
        const parsedCharacters = await this.llm.completeJson<unknown>({
          model,
          retries: 2,
          messages: [
            { role: 'system', content: requiredCharactersPrompt },
            {
              role: 'user',
              content:
                'Return ONLY valid JSON in this exact shape: ' +
                '{"characters": [{"key":"C1","name":"...","description":"...","isSahaba":false,"isProphet":false,"isWoman":false}]}\n\n' +
                segment,
            },
          ],
        });

        return normalizeCharacters(parsedCharacters);
      };

      const extractCharacters = async (): Promise<ScriptCharacter[]> => {
        try {
          if (extractionSegments.length <= 1) {
            return extractCharactersFromSegment(
              extractionSegments[0] ?? script,
            );
          }

          const extractedChunks = await Promise.all(
            extractionSegments.map((segment) =>
              extractCharactersFromSegment(segment).catch((error) => {
                console.warn(
                  'splitScript character extraction chunk fallback:',
                  error,
                );
                return [];
              }),
            ),
          );

          const combinedCharacters = extractedChunks.flat();
          if (combinedCharacters.length === 0) return [];
          const dedupedCandidates = dedupeCharacters(combinedCharacters);

          const combinedPrompt = combinedCharacters
            .map(
              (character, index) =>
                `Candidate ${index + 1}: ${character.name} — ${character.description} | isSahaba=${character.isSahaba} | isProphet=${character.isProphet} | isWoman=${character.isWoman}`,
            )
            .join('\n');

          try {
            const mergedCharacters = await this.llm.completeJson<unknown>({
              model,
              retries: 2,
              messages: [
                { role: 'system', content: requiredCharactersPrompt },
                {
                  role: 'user',
                  content:
                    'Merge and deduplicate these candidate characters into the final canonical list for the full script. Return ONLY valid JSON in this exact shape: ' +
                    '{"characters": [{"key":"C1","name":"...","description":"...","isSahaba":false,"isProphet":false,"isWoman":false}]}\n\n' +
                    'CANDIDATE CHARACTERS FROM FULL-SCRIPT CHUNKS:\n' +
                    combinedPrompt,
                },
              ],
            });

            const normalizedMergedCharacters =
              normalizeCharacters(mergedCharacters);
            return normalizedMergedCharacters.length
              ? normalizedMergedCharacters
              : dedupedCandidates;
          } catch (mergeError) {
            console.warn('splitScript character merge fallback:', mergeError);
            return dedupedCandidates;
          }
        } catch (error) {
          console.warn('splitScript character extraction fallback:', error);
          return [];
        }
      };

      const requiredLocationsPrompt =
        'You extract the different canonical LOCATIONS from a narration script.\n' +
        'Always respond with pure JSON as an OBJECT with exactly this shape: ' +
        '{"locations": [{"key": string, "name": string, "description"?: string}]}\n\n' +
        'Rules:\n' +
        '- Extract the different canonical LOCATIONS that are relevant to the story.\n' +
        '- Use keys E1, E2, E3... (do NOT use E0).\n' +
        '- Keep location.name short and production-friendly (e.g. "Desert caravan route", "Ottoman court interior", "Modern city rooftop").\n' +
        '- The description must be maximum two lines and must describe environment structure, time of day\n' +
        "- Don't add any human or character details; focus only on the place, time of day, weather, lighting, mood, and surrounding environment.\n" +
        '- Multiple sentences can share the same location. Do NOT create one location per sentence.\n' +
        '- If the story revisits the same place later, reuse the same location concept.\n' +
        '- If the sentence context is not visually distinct enough to justify a canonical location, do not force a new one.\n';

      const extractLocationsFromSegment = async (
        segment: string,
      ): Promise<ScriptLocation[]> => {
        const parsedLocations = await this.llm.completeJson<unknown>({
          model,
          retries: 2,
          messages: [
            { role: 'system', content: requiredLocationsPrompt },
            {
              role: 'user',
              content:
                'Return ONLY valid JSON in this exact shape: ' +
                '{"locations": [{"key":"E1","name":"...","description":"..."}]}\n\n' +
                segment,
            },
          ],
        });

        return normalizeLocations(parsedLocations);
      };

      const extractLocations = async (): Promise<ScriptLocation[]> => {
        try {
          if (extractionSegments.length <= 1) {
            return extractLocationsFromSegment(extractionSegments[0] ?? script);
          }

          const extractedChunks = await Promise.all(
            extractionSegments.map((segment) =>
              extractLocationsFromSegment(segment).catch((error) => {
                console.warn(
                  'splitScript location extraction chunk fallback:',
                  error,
                );
                return [];
              }),
            ),
          );

          const combinedLocations = extractedChunks.flat();
          if (combinedLocations.length === 0) return [];
          const dedupedCandidates = dedupeLocations(combinedLocations);

          const combinedPrompt = combinedLocations
            .map(
              (location, index) =>
                `Candidate ${index + 1}: ${location.name}${location.description ? ` — ${location.description}` : ''}`,
            )
            .join('\n');

          try {
            const mergedLocations = await this.llm.completeJson<unknown>({
              model,
              retries: 2,
              messages: [
                { role: 'system', content: requiredLocationsPrompt },
                {
                  role: 'user',
                  content:
                    'Merge and deduplicate these candidate locations into the final canonical list for the full script. Return ONLY valid JSON in this exact shape: ' +
                    '{"locations": [{"key":"E1","name":"...","description":"..."}]}\n\n' +
                    'CANDIDATE LOCATIONS FROM FULL-SCRIPT CHUNKS:\n' +
                    combinedPrompt,
                },
              ],
            });

            const normalizedMergedLocations =
              normalizeLocations(mergedLocations);
            return normalizedMergedLocations.length
              ? normalizedMergedLocations
              : dedupedCandidates;
          } catch (mergeError) {
            console.warn('splitScript location merge fallback:', mergeError);
            return dedupedCandidates;
          }
        } catch (error) {
          console.warn('splitScript location extraction fallback:', error);
          return [];
        }
      };

      const characters = await extractCharacters();
      const locations = await extractLocations();

      const requiredSplitAndTagPrompt =
        'You split a script into clean sentences (verbatim) and tag each sentence with character keys + a location key.\n' +
        'You are given canonical CHARACTERS and LOCATIONS with keys. Use ONLY those keys.\n' +
        'Always respond with pure JSON as an OBJECT with exactly this shape: ' +
        '{"sentences": [{"text": string, "characterKeys": string[], "locationKey": string | null}]}\n\n' +
        'Rules:\n' +
        '- Do NOT add/remove/rewrite words; only split into sentences. Sentence text MUST match the script wording verbatim.\n' +
        (isLongFormScript
          ? '- LONG-FORM MODE: Preserve naturally long spoken sentences. Do NOT split one grammatical sentence into multiple items unless there is a true sentence boundary in the text.\n'
          : '- SHORT-FORM MODE: Prefer tighter spoken sentence units when a natural sentence boundary already exists in the text.\n') +
        '- characterKeys must be a subset of the provided character keys (or empty).\n' +
        '- If a sentence describes a battle/fight/combat moment, include the relevant GROUP/ARMY character keys for the sides involved (in addition to any named protagonists mentioned).\n' +
        '- locationKey must be one of the provided location keys OR null.\n' +
        '- Infer a location ONLY if the TARGET sentence clearly implies one of the provided canonical locations.\n' +
        '- Use script context only to resolve references/pronouns for the target sentence.\n' +
        '- If the sentence does NOT imply a clear canonical location, set locationKey to null (do NOT guess).\n' +
        '- No extra keys. No extra text.';

      const charactersList = characters
        .map((c) => `${c.key}: ${c.name} — ${c.description}`)
        .join('\n');

      const locationsList = locations
        .map(
          (location) =>
            `${location.key}: ${location.name}${location.description ? ` — ${location.description}` : ''}`,
        )
        .join('\n');

      const validCharacterKeys = new Set(characters.map((c) => c.key));
      const validLocationKeys = new Set(
        locations.map((location) => location.key),
      );

      const sentenceRegexCount = (value: string): number => {
        const matches = value.match(/[.!?]+(?=\s|$)/gu);
        return matches?.length ?? 0;
      };

      const shouldUseChunkedMode =
        script.length > 7000 || sentenceRegexCount(script) > 24;

      const splitSentencesWithLlmInChunks = async (): Promise<
        SplitSentenceRecord[]
      > => {
        const segments = splitScriptIntoLlmSegments(script);
        if (!segments.length) {
          return buildSentenceRecords(splitScriptVerbatim(script));
        }

        const sentenceSplitPrompt =
          'You split a script segment into clean spoken sentences verbatim.\n' +
          'Always respond with pure JSON as an OBJECT with exactly this shape: ' +
          '{"sentences": [{"text": string}]}\n\n' +
          'Rules:\n' +
          '- Keep the original wording exactly as written. Do NOT paraphrase, summarize, or add words.\n' +
          (isLongFormScript
            ? '- LONG-FORM MODE: Keep naturally long narration sentences intact. Do NOT break a sentence into smaller parts just because it is lengthy; split only at true sentence-ending punctuation or very strong narration breaks already present in the text.\n'
            : '- SHORT-FORM MODE: Keep sentence units concise when the text already contains natural sentence-ending punctuation.\n') +
          '- Preserve the original order.\n' +
          '- Cover the entire segment exactly once with no omissions and no duplicates.\n' +
          '- Each output item must be a natural sentence-sized narration unit.\n' +
          '- If a fragment cannot be split further without rewriting, keep it as one item.\n' +
          '- No extra keys. No extra text.';

        const sentenceTexts: string[] = [];

        for (const segment of segments) {
          try {
            const parsedChunk = await this.llm.completeJson<unknown>({
              model,
              retries: 2,
              messages: [
                { role: 'system', content: sentenceSplitPrompt },
                {
                  role: 'user',
                  content:
                    'Return ONLY valid JSON in this exact shape: ' +
                    '{"sentences": [{"text":"..."}]}\n\n' +
                    'SCRIPT SEGMENT (split only, verbatim):\n' +
                    segment,
                },
              ],
            });

            const chunkSentences = normalizeSplitSentenceTexts(parsedChunk);
            sentenceTexts.push(
              ...(chunkSentences.length
                ? chunkSentences
                : splitScriptVerbatim(segment)),
            );
          } catch (error) {
            console.warn(
              'splitScript chunk sentence-splitting fallback:',
              error,
            );
            sentenceTexts.push(...splitScriptVerbatim(segment));
          }
        }

        const fallbackTexts = sentenceTexts.length
          ? sentenceTexts
          : splitScriptVerbatim(script);

        return buildSentenceRecords(fallbackTexts);
      };

      const splitAndTagInChunks = async (
        sentenceRecords: SplitSentenceRecord[],
      ) => {
        if (!sentenceRecords.length) {
          return buildSentenceRecords([script]);
        }

        const taggingPrompt =
          'You are tagging sentences that are already split.\n' +
          'Always respond with pure JSON as an OBJECT with exactly this shape: ' +
          '{"items": [{"index": number, "characterKeys": string[], "locationKey": string | null}]}\n\n' +
          'Rules:\n' +
          '- Return exactly one item for each TARGET SENTENCE index.\n' +
          '- Do NOT rewrite or repeat sentence text.\n' +
          '- characterKeys must be a subset of the provided character keys (or empty).\n' +
          '- If a sentence describes a battle/fight/combat moment, include the relevant GROUP/ARMY character keys for the sides involved.\n' +
          '- locationKey must be one of the provided location keys OR null.\n' +
          '- Use local sentence order and optional context sentences only to resolve references/pronouns.\n' +
          '- No extra keys. No extra text.';

        const chunks = chunkSentenceRecords(sentenceRecords);
        const taggedSentences: SplitSentenceRecord[] = [];

        for (const chunk of chunks) {
          const previousSentence =
            chunk.start > 0
              ? (sentenceRecords[chunk.start - 1]?.text ?? null)
              : null;
          const nextSentence =
            chunk.start + chunk.items.length < sentenceRecords.length
              ? (sentenceRecords[chunk.start + chunk.items.length]?.text ??
                null)
              : null;

          try {
            const parsedChunk = await this.llm.completeJson<unknown>({
              model,
              retries: 2,
              messages: [
                { role: 'system', content: taggingPrompt },
                {
                  role: 'user',
                  content:
                    'Return ONLY valid JSON in this exact shape: ' +
                    '{"items": [{"index": 0, "characterKeys": ["C1"], "locationKey": "E1"}]}\n\n' +
                    'CANONICAL CHARACTERS (use ONLY these keys):\n' +
                    (charactersList ? charactersList : '(none)') +
                    '\n\n' +
                    'CANONICAL LOCATIONS (use ONLY these keys):\n' +
                    (locationsList ? locationsList : '(none)') +
                    '\n\n' +
                    (previousSentence
                      ? `PREVIOUS CONTEXT SENTENCE:\n${previousSentence}\n\n`
                      : '') +
                    'TARGET SENTENCES:\n' +
                    chunk.items
                      .map((item, index) => `${index}: ${item.text}`)
                      .join('\n') +
                    '\n\n' +
                    (nextSentence
                      ? `NEXT CONTEXT SENTENCE:\n${nextSentence}`
                      : ''),
                },
              ],
            });

            const normalizedChunk = normalizeTaggedSentenceChunk(
              parsedChunk,
              chunk.items.map((item) => item.text),
              validCharacterKeys,
              validLocationKeys,
            );

            taggedSentences.push(
              ...chunk.items.map((item, index) => ({
                ...item,
                characterKeys: normalizedChunk[index]?.characterKeys ?? [],
                locationKey: normalizedChunk[index]?.locationKey ?? null,
              })),
            );
          } catch (error) {
            console.warn('splitScript chunk tagging fallback:', error);
            taggedSentences.push(
              ...chunk.items.map((item) => ({
                ...item,
                characterKeys: [],
                locationKey: null,
              })),
            );
          }
        }

        return finalizeTaggedSentences(taggedSentences);
      };

      let sentences: SplitSentenceRecord[];

      if (shouldUseChunkedMode) {
        const sentenceRecords = await splitSentencesWithLlmInChunks();
        sentences = await splitAndTagInChunks(sentenceRecords);
      } else {
        try {
          const parsedSentences = await this.llm.completeJson<unknown>({
            model,
            retries: 2,
            messages: [
              { role: 'system', content: requiredSplitAndTagPrompt },
              {
                role: 'user',
                content:
                  'Return ONLY valid JSON in this exact shape: ' +
                  '{"sentences": [{"text":"...","characterKeys":["C1"],"locationKey":"E1"}]}\n\n' +
                  'CANONICAL CHARACTERS (use ONLY these keys):\n' +
                  (charactersList ? charactersList : '(none)') +
                  '\n\n' +
                  'CANONICAL LOCATIONS (use ONLY these keys):\n' +
                  (locationsList ? locationsList : '(none)') +
                  '\n\n' +
                  'SCRIPT (split + tag):\n' +
                  script,
              },
            ],
          });

          sentences = finalizeTaggedSentences(
            normalizeSentenceItems(
              parsedSentences,
              validCharacterKeys,
              validLocationKeys,
            ),
          );
        } catch (error) {
          console.warn('splitScript full tagging fallback:', error);
          const fallbackSentenceRecords = shouldUseChunkedMode
            ? await splitSentencesWithLlmInChunks()
            : buildSentenceRecords(splitScriptVerbatim(script));
          sentences = await splitAndTagInChunks(fallbackSentenceRecords);
        }
      }

      if (!sentences.length) {
        sentences = buildSentenceRecords([script]);
      }

      return {
        sentences: toSplitSentenceResponse(sentences),
        characters,
        locations,
      };
    } catch {
      throw new InternalServerErrorException(
        'Failed to split script into sentences',
      );
    }
  }

  async splitIntoShorts(dto: {
    sentences: string[];
    model?: string;
    systemPrompt?: string;
  }): Promise<{ ranges: Array<{ start: number; end: number }> }> {
    const sentencesRaw = Array.isArray(dto?.sentences) ? dto.sentences : [];
    const sentences = sentencesRaw
      .map((s) => String(s ?? '').trim())
      .filter(Boolean);

    if (sentences.length === 0) {
      throw new BadRequestException('sentences is required');
    }

    const model = dto.model?.trim() || this.model;
    const wpm = 150;
    const minSecondsPerShort = 60;

    const wordCount = (text: string) =>
      text.trim().split(/\s+/u).filter(Boolean).length;

    const sentenceMeta = sentences.map((text, index) => {
      const words = wordCount(text);
      const estSeconds = Math.max(1, Math.round((words * 60) / wpm));
      return { index, words, estSeconds, text };
    });

    const totalSeconds = sentenceMeta.reduce((sum, s) => sum + s.estSeconds, 0);

    const greedyFallback = (): {
      ranges: Array<{ start: number; end: number }>;
    } => {
      if (sentences.length === 1) {
        return { ranges: [{ start: 0, end: 0 }] };
      }

      // If the entire thing is too short, return a single short.
      if (totalSeconds <= minSecondsPerShort) {
        return { ranges: [{ start: 0, end: sentences.length - 1 }] };
      }

      const ranges: Array<{ start: number; end: number }> = [];
      let start = 0;
      let cursorSeconds = 0;

      for (let i = 0; i < sentenceMeta.length; i += 1) {
        cursorSeconds += sentenceMeta[i].estSeconds;

        const remainingSeconds = sentenceMeta
          .slice(i + 1)
          .reduce((sum, s) => sum + s.estSeconds, 0);

        const canCutHere = cursorSeconds >= minSecondsPerShort;
        const remainderWouldBeValid =
          remainingSeconds === 0 || remainingSeconds >= minSecondsPerShort;

        if (canCutHere && remainderWouldBeValid) {
          ranges.push({ start, end: i });
          start = i + 1;
          cursorSeconds = 0;
        }
      }

      if (start <= sentenceMeta.length - 1) {
        if (ranges.length === 0) {
          ranges.push({ start: 0, end: sentenceMeta.length - 1 });
        } else {
          // Merge any leftover into the last range.
          ranges[ranges.length - 1].end = sentenceMeta.length - 1;
        }
      }

      // Ensure contiguity and coverage.
      const normalized: Array<{ start: number; end: number }> = [];
      let expectedStart = 0;
      for (const r of ranges) {
        const s = Math.max(
          expectedStart,
          Math.min(r.start, sentenceMeta.length - 1),
        );
        const e = Math.max(s, Math.min(r.end, sentenceMeta.length - 1));
        normalized.push({ start: s, end: e });
        expectedStart = e + 1;
      }
      if (normalized.length > 0) {
        normalized[0].start = 0;
        normalized[normalized.length - 1].end = sentenceMeta.length - 1;
        for (let i = 1; i < normalized.length; i += 1) {
          normalized[i].start = normalized[i - 1].end + 1;
        }
      }

      return { ranges: normalized };
    };

    // If the whole thing is shorter than the minimum, no need for the model.
    if (totalSeconds <= minSecondsPerShort) {
      return { ranges: [{ start: 0, end: sentences.length - 1 }] };
    }

    const requiredPrompt =
      'You split an ordered sentence list into multiple SHORTS (segments) without rewriting any text.\n' +
      'Always respond with pure JSON as an OBJECT with exactly this shape: {"ranges": [{"start": number, "end": number}]}.\n\n' +
      'Rules:\n' +
      `- Sentences are indexed 0..${sentences.length - 1}.\n` +
      '- Choose the number of shorts as needed. Do NOT force a fixed number of sentences per short.\n' +
      '- Each short should feel like a complete story with a clear ending beat (closure), not a random cutoff.\n' +
      '- Ranges must be contiguous, in order, cover all sentences, and have no overlaps or gaps.\n' +
      '- First range.start MUST be 0.\n' +
      `- Last range.end MUST be ${sentences.length - 1}.\n` +
      '- Each range must contain at least 1 sentence.\n' +
      `- Each range must have estimated duration >= ${minSecondsPerShort} seconds based on the provided per-sentence estimates.\n` +
      '- Do not add extra keys. Do not add any explanation text.';

    const systemPrompt = [dto.systemPrompt?.trim(), requiredPrompt]
      .filter(Boolean)
      .join('\n');

    const userContent =
      'Return ONLY valid JSON in this exact shape: {"ranges": [{"start":0,"end":3}]}.\n\n' +
      `Minimum seconds per short: ${minSecondsPerShort}.\n` +
      `Words-per-minute estimate: ${wpm}.\n\n` +
      'Goal: split into shorts that each end with a satisfying closure beat.\n\n' +
      'Here are the sentences with estimated seconds:\n' +
      sentenceMeta
        .map(
          (s) => `${s.index}. (${s.estSeconds}s est) ${JSON.stringify(s.text)}`,
        )
        .join('\n');

    try {
      const parsed = await this.llm.completeJson<unknown>({
        model,
        retries: 1,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      });

      const rangesRaw =
        parsed &&
          typeof parsed === 'object' &&
          Array.isArray((parsed as any).ranges)
          ? ((parsed as any).ranges as any[])
          : null;

      if (!rangesRaw || rangesRaw.length === 0) {
        return greedyFallback();
      }

      const ranges = rangesRaw
        .map((r) => ({
          start: Number(r?.start),
          end: Number(r?.end),
        }))
        .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end))
        .map((r) => ({ start: Math.trunc(r.start), end: Math.trunc(r.end) }));

      if (ranges.length === 0) {
        return greedyFallback();
      }

      // Validate contiguity and bounds.
      const lastIndex = sentences.length - 1;
      if (ranges[0].start !== 0) return greedyFallback();
      if (ranges[ranges.length - 1].end !== lastIndex) return greedyFallback();

      for (let i = 0; i < ranges.length; i += 1) {
        const r = ranges[i];
        if (r.start < 0 || r.end < r.start || r.end > lastIndex)
          return greedyFallback();
        if (i > 0) {
          const prev = ranges[i - 1];
          if (r.start !== prev.end + 1) return greedyFallback();
        }

        const segSeconds = sentenceMeta
          .slice(r.start, r.end + 1)
          .reduce((sum, s) => sum + s.estSeconds, 0);
        if (segSeconds < minSecondsPerShort) return greedyFallback();
      }

      return { ranges };
    } catch {
      return greedyFallback();
    }
  }

  async createEnhanceScriptStream(dto: EnhanceScriptDto) {
    const baseScript = dto.script?.trim();
    if (!baseScript) {
      throw new BadRequestException('Script is required for enhancement');
    }

    const length = dto.length?.trim() || '1 minute';
    const style = dto.style?.trim() || 'Conversational';
    const technique = this.normalizeTechnique(dto.technique);
    const languageCode = String(dto.language ?? '').trim() || 'en';
    const model = dto.model?.trim() || this.model;
    const customSystemPrompt = dto.systemPrompt?.trim();
    const wordRange = this.getStrictWordRange(length);

    const languageDesc = (() => {
      const code = languageCode;
      switch (code.toLowerCase()) {
        case 'en':
          return 'English (en)';
        case 'ar':
          return 'Arabic (ar)';
        case 'fr':
          return 'French (fr)';
        case 'es':
          return 'Spanish (es)';
        case 'de':
          return 'German (de)';
        case 'it':
          return 'Italian (it)';
        case 'pt':
          return 'Portuguese (pt)';
        case 'ru':
          return 'Russian (ru)';
        case 'tr':
          return 'Turkish (tr)';
        case 'hi':
          return 'Hindi (hi)';
        case 'ur':
          return 'Urdu (ur)';
        case 'id':
          return 'Indonesian (id)';
        case 'ja':
          return 'Japanese (ja)';
        case 'ko':
          return 'Korean (ko)';
        case 'zh-cn':
        case 'zh':
          return 'Chinese (Simplified) (zh-CN)';
        default:
          return `${code} (target language code)`;
      }
    })();

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
      `LANGUAGE REQUIREMENT: Output MUST be in ${languageDesc}. Do NOT mix languages.`,
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
          { role: 'system', content: enhanceSystemPrompt },
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
    } catch {
      throw new InternalServerErrorException('Failed to enhance script');
    }
  }

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
    } catch {
      throw new InternalServerErrorException('Failed to enhance sentence');
    }
  }

  async generateMediaSearchTerm(dto: GenerateMediaSearchTermDto): Promise<{
    searchTerm: string;
  }> {
    const medium = dto.medium;
    const sentence = String(dto?.sentence ?? '').trim();
    const script = String(dto?.script ?? '').trim();
    const model = String(dto?.model ?? '').trim() || this.cheapModel;

    if (!sentence) {
      throw new BadRequestException('Sentence is required');
    }

    try {
      const parsed = await this.llm.completeJson<{ searchTerm?: unknown }>({
        model,
        retries: 2,
        messages: [
          {
            role: 'system',
            content:
              'You generate stock-media library search terms.\n' +
              'Always return strict JSON with exactly this shape: {"searchTerm": string}.\n' +
              'The searchTerm must be 1 to 3 words only.\n' +
              'It must be a visually searchable keyword phrase, never a sentence.\n' +
              'The searchTerm must represent the feel sentence in the context of the script\n' +
              'Do not include punctuation, quotes, explanations, or extra fields.',
          },
          {
            role: 'user',
            content:
              `Medium: ${medium}.\n` +
              `Full script context:\n${script || sentence}\n\n` +
              `Current sentence:\n${sentence}\n\n` +
              'Return only JSON.',
          },
        ],
      });

      const searchTerm = String(parsed?.searchTerm ?? '')
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .slice(0, 3)
        .join(' ')
        .trim();

      if (!searchTerm) {
        throw new InternalServerErrorException(
          'Empty media search term returned',
        );
      }

      return { searchTerm };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      console.error('Failed to generate media search term:', error);
      throw new InternalServerErrorException(
        'Failed to generate media search term',
      );
    }
  }

  async createVoiceStyleInstructionsStream(dto: {
    script: string;
    model?: string;
  }) {
    const script = String(dto?.script ?? '').trim();
    if (!script) {
      throw new BadRequestException('Script is required');
    }

    const model = String(dto?.model ?? '').trim() || this.cheapModel;

    const systemPrompt =
      'You are a voice director for short-form narration (reels/shorts).\n' +
      'Given a SCRIPT, you produce detailed style instructions for AI Studio / TTS.\n' +
      'Respond with ONLY the style instructions text (no headings, no markdown, no quotes).\n\n' +
      'Requirements:\n' +
      '- Be specific and actionable: tone, emotion, pace, pauses, emphasis, energy, smile/brightness, seriousness, cadence.\n' +
      '- Mention any tricky pronunciations ONLY if the script implies them.\n' +
      '- Keep it concise but detailed: 4-10 short lines max.\n' +
      '- Do NOT repeat the script. Do NOT add meta commentary.';

    return this.llm.streamText({
      model,
      maxTokens: 400,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content:
            'SCRIPT (derive voice style/tone instructions from this):\n' +
            script,
        },
      ],
    });
  }

  async generateTitleForScript(script: string): Promise<string> {
    const trimmed = script?.trim();
    if (!trimmed) return 'Untitled Script';

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

      if (!title) return 'Untitled Script';
      return title.length > 255 ? title.slice(0, 252).trimEnd() + '...' : title;
    } catch {
      return 'Untitled Script';
    }
  }

  async generateVideoPrompt(dto: {
    script?: string;
    sentence: string;
    mode?: 'text' | 'referenceImage';
    model?: string;
  }): Promise<string> {
    const sentence = String(dto?.sentence ?? '').trim();
    if (!sentence) return '';

    const mode = dto?.mode ?? 'text';
    const rawScript = String(dto?.script ?? '').trim();

    // Keep token usage bounded; still enough context for tone/consistency.
    const script =
      rawScript.length > 8000 ? rawScript.slice(0, 8000) : rawScript;

    try {
      const result = (
        await this.llm.completeText({
          model: (dto?.model ?? this.model) as any,
          maxTokens: 320,
          temperature: 0.5,
          messages: [
            {
              role: 'system',
              content:
                'You write prompts for AI video generation. ' +
                'Return ONLY the final prompt text (no quotes, no markdown, no labels). ' +
                'Make it vivid and specific: shot type, camera motion, lighting, mood, setting, subject, composition. ' +
                'Avoid violence/gore, explicit content, or hateful content.',
            },
            {
              role: 'user',
              content:
                `MODE: ${mode}\n` +
                (script
                  ? `FULL SCRIPT CONTEXT (for consistency):\n${script}\n\n`
                  : '') +
                `SENTENCE (this scene):\n${sentence}\n\n` +
                'Generate a single, model-ready video prompt for this sentence. ' +
                'Keep it under ~80 words.',
            },
          ],
        })
      )?.trim();

      if (!result) return sentence;
      // Safety cap to avoid extremely long prompts.
      return result.length > 2000 ? result.slice(0, 2000).trimEnd() : result;
    } catch {
      return sentence;
    }
  }

  async translate(
    dto: TranslateDto,
  ): Promise<{ script?: string; sentences?: string[] }> {
    const targetLanguage = String(dto?.targetLanguage ?? '').trim();
    if (!targetLanguage) {
      throw new BadRequestException('targetLanguage is required');
    }

    const normalizeLanguageCode = (code: string): string => {
      const trimmed = String(code ?? '').trim();
      if (!trimmed) return '';
      const lower = trimmed.toLowerCase();

      // Frontend uses zh-CN; translate-google generally expects lowercase.
      if (lower === 'zh-cn' || lower === 'zh-hans' || lower === 'zh')
        return 'zh-cn';
      return lower;
    };

    const normalizedTargetLanguage = normalizeLanguageCode(targetLanguage);

    const method: 'google' | 'llm' = dto?.method ?? 'google';

    const scriptRaw = dto?.script;
    const script = typeof scriptRaw === 'string' ? scriptRaw.trim() : '';

    const sentencesRaw = Array.isArray(dto?.sentences)
      ? dto.sentences
      : undefined;
    const sentences =
      sentencesRaw === undefined
        ? undefined
        : sentencesRaw.map((s) => String(s ?? ''));

    if (!script && (!sentences || sentences.length === 0)) {
      throw new BadRequestException(
        'Provide `script` and/or a non-empty `sentences` array',
      );
    }

    const normalizeGoogleResult = (result: any): string => {
      if (typeof result === 'string') return result;
      const text = typeof result?.text === 'string' ? result.text : '';
      return text || '';
    };

    const translateWithGoogle = async (text: string): Promise<string> => {
      const res = await translateGoogle(text, {
        to: normalizedTargetLanguage,
      });
      return normalizeGoogleResult(res);
    };

    const translateManyWithGoogle = async (
      texts: string[],
    ): Promise<string[]> => {
      const out: string[] = [];
      for (const t of texts) {
        // Preserve array length exactly. Allow empty strings.
        if (!t) {
          out.push('');
          continue;
        }
        out.push(await translateWithGoogle(t));
      }
      return out;
    };

    const translateManyWithLlm = async (texts: string[]): Promise<string[]> => {
      const model = String(dto?.model ?? '').trim() || this.model;
      const chunkSize = 20;
      const out: string[] = [];

      for (let i = 0; i < texts.length; i += chunkSize) {
        const chunk = texts.slice(i, i + chunkSize);

        const systemPrompt =
          'You are a professional translator for short narration scripts.\n' +
          'Translate every input string into the requested target language.\n' +
          'IMPORTANT: You must preserve the number of items and their order.\n' +
          'Return ONLY valid JSON in this exact shape: {"translations": string[]}.\n' +
          'Do not add explanations or extra keys.';

        const userPrompt =
          `Target language: ${targetLanguage} (code: ${normalizedTargetLanguage})\n` +
          'Translate these items. Preserve meaning and natural tone for narration.\n\n' +
          'Input JSON:\n' +
          JSON.stringify({ items: chunk });

        const parsed = await this.llm.completeJson<unknown>({
          model,
          temperature: 0.2,
          maxTokens: 2000,
          retries: 1,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        });

        const translations = (parsed as any)?.translations;
        if (
          !Array.isArray(translations) ||
          translations.length !== chunk.length
        ) {
          throw new InternalServerErrorException(
            'LLM translation returned an invalid shape/length',
          );
        }

        for (const t of translations) {
          out.push(String(t ?? ''));
        }
      }

      return out;
    };

    const translateMany = async (texts: string[]): Promise<string[]> => {
      try {
        if (method === 'llm') return await translateManyWithLlm(texts);
        return await translateManyWithGoogle(texts);
      } catch (err) {
        console.error('Translation failed', err);
        throw new InternalServerErrorException('Failed to translate');
      }
    };

    const result: { script?: string; sentences?: string[] } = {};

    if (script) {
      const [translated] = await translateMany([script]);
      result.script = translated;
    }

    if (sentences !== undefined) {
      result.sentences = await translateMany(sentences);
    }

    return result;
  }
}
