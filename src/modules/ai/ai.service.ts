import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { GenerateScriptDto } from './dto/generate-script.dto';
import { GenerateImageDto } from './dto/generate-image.dto';
import { EnhanceScriptDto } from './dto/enhance-script.dto';
import { EnhanceSentenceDto } from './dto/enhance-sentence.dto';
import { ImagesService } from '../images/images.service';
import { ImageQuality, ImageSize } from '../images/entities/image.entity';

@Injectable()
export class AiService {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly cheapModel: string;
  private readonly imageModel: string;
  private readonly elevenApiKey?: string;
  private readonly elevenDefaultVoiceId: string;
  private readonly leonardoApiKey?: string;
  private readonly leonardoModelId?: string;

  private readonly forbiddenIslamicDepictionRegex =
    /\b(allah|god|deity|divine\s*being|prophet|messenger\s+of\s+allah|rasul|rasool|muhammad|mohammad|ahmad|isa|jesus|moses|musa|ibrahim|abraham|noah|nuh|yusuf|joseph|yakub|yaqub|jacob|dawud|david|sulayman|solomon|yunus|jonah|aisha|khadija|fatima|abu\s*bakr|umar|u?thman|ali\b|sahaba|companions?|caliphs?|archangel|angel\s+gabriel|jibril|jibreel|quran\s+page|quranic\s+text|quran\s+verse|surah|ayah|arabic\s+text|quranic\s+script|mushaf|quran\s+book)\b/i;

  // Narration pacing assumption (words per minute) used to derive strict word-count targets.
  private readonly narrationWpm = 150;

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
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      // Fail fast if the key is missing so it's obvious in dev
      throw new Error('OPENAI_API_KEY is not set in the environment.');
    }

    this.client = new OpenAI({ apiKey });
    this.model = process.env.OPENAI_MODEL || 'gpt-5.2';
    // Used for small classification tasks (cheaper/faster than the main model).
    this.cheapModel = process.env.OPENAI_CHEAP_MODEL || 'gpt-4o-mini';
    this.imageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
    this.elevenApiKey = process.env.ELEVENLABS_API_KEY;
    this.elevenDefaultVoiceId =
      process.env.ELEVENLABS_VOICE_ID || 'BtWabtumIemAotTjP5sk';
    this.leonardoApiKey = process.env.LEONARDO_API_KEY;
    this.leonardoModelId = process.env.LEONARDO_MODEL_ID;
  }

  private parseApproxLengthToSeconds(lengthRaw: string): number | null {
    const s = (lengthRaw || '').toLowerCase().trim();
    if (!s) return null;

    // Match patterns like "1 minute", "2.5 min", "90 seconds", "30 sec"
    const match = s.match(/(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m)\b/);
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

  private getStrictWordRange(lengthRaw: string): { targetWords: number; minWords: number; maxWords: number } {
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

  private async containsForbiddenIslamicDepiction(text: string): Promise<boolean> {
    const s = (text || '').toLowerCase();
    if (!s) return false;

    // Quick checks first - explicit mentions
    if (s.includes('prophet') || s.includes('sahaba') || s.includes('companion') ||
      s.includes('quran page') || s.includes('quranic text') || s.includes('quran verse') ||
      s.includes('arabic text') || s.includes('surah') || s.includes('ayah') || s.includes('mushaf')) {
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
      const contextCheck = await this.client.chat.completions.create({
        model: this.cheapModel,
        temperature: 0,
        max_tokens: 3,
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

      const response = contextCheck.choices[0]?.message?.content?.trim().toLowerCase();
      return response === 'yes';
    } catch (error) {
      console.error('Error checking pronoun context:', error);
      // If LLM check fails, be conservative and return true if there are pronouns
      // in a potentially religious context
      const religiousContext = /\b(islam|muslim|quran|hadith|faith|allah|worship|prayer)\b/i.test(text);
      return religiousContext && hasPronouns;
    }
  }

  private extractBooleanFromModelText(raw: string | null | undefined): boolean | null {
    const text = (raw ?? '').trim().toLowerCase();
    if (!text) return null;

    if (text === 'true' || text === 'yes' || text === 'y') return true;
    if (text === 'false' || text === 'no' || text === 'n') return false;

    // Sometimes models respond with JSON.
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'boolean') return parsed;
      if (parsed && typeof parsed === 'object') {
        const v = (parsed as any).mentions ?? (parsed as any).result ?? (parsed as any).value;
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
  }): Promise<boolean> {
    const sentence = (params.sentence ?? '').trim();
    if (!sentence) return false;

    const quickHitRegex =
      /\b(allah|the\s+prophet|prophet\s+muhammad|muhammad|mohammad|rasulullah|rasul\s*allah|messenger\s+of\s+allah|pbuh|peace\s+be\s+upon\s+him|sahaba|companions?|abu\s*bakr|umar|\bu?thman\b|ali\b|bilal|khalid\s+ibn\s+walid|salman\s+al\s+farisi|abu\s+hurairah|aisha|khadija|fatima)\b/i;
    if (quickHitRegex.test(sentence)) return true;

    const script = (params.script ?? '').trim();
    const scriptForContext = script ? script.slice(0, 8000) : '';

    try {
      const completion = await this.client.chat.completions.create({
        model: 'gpt-4.1',
        messages: [
          {
            role: 'system',
            content:
              'You are a strict boolean classifier. ' +
              'Return ONLY "true" or "false" (no punctuation, no extra text).\n\n' +
              'Task: Determine whether the TARGET SENTENCE mentions OR refers to any of the following (directly or via pronouns resolved using the provided SCRIPT CONTEXT):\n' +
              '1) Allah (or God when clearly used in Islamic context)\n' +
              '2) Any Prophet\n' +
              '3) Any Sahaba / Companions of Prophet Muhammad (including common names like Abu Bakr, Umar, Uthman, Ali, etc.)\n\n' +
              'Rules:\n' +
              '- Use SCRIPT CONTEXT only to resolve pronouns / references for the TARGET SENTENCE.\n' +
              '- If the sentence is talking about a regular person (not tied to the list), return false.\n' +
              '- If unclear/ambiguous, return false.',
          },
          {
            role: 'user',
            content:
              (scriptForContext
                ? `SCRIPT CONTEXT (for reference resolution):\n${scriptForContext}\n\n`
                : '') +
              `TARGET SENTENCE:\n${sentence}`,
          },
        ],
      });

      const raw = completion.choices[0]?.message?.content;
      const parsed = this.extractBooleanFromModelText(raw);
      return parsed ?? false;
    } catch (error) {
      console.error('Error classifying Allah/Prophet/Sahaba reference:', error);
      // Non-fatal: default to false so we don't unexpectedly restrict prompts.
      return false;
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
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
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
      } else {
        const writingGoals = haveCustomPrompt
          ? `${customSystemPrompt}\n`
          :
          `1) Get Straight to the Point/Subject: Hook the viewer within the first 3 seconds. Avoid long intros or fluffy openings.\n` +
          `2) Curiosity / Open Loops: introduce an unanswered question early and pay it off later.\n` +
          `3) Story Arc / Micro Narrative: a clear setup → tension/problem → insight/turn → resolution.\n` +
          `4) Rhythm & Pacing: short punchy lines mixed with a few longer lines; avoid monotone cadence.\n` +
          `5) Emotional Trigger: open with a strong feeling (awe, hope, urgency, empathy, etc.).\n`;

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
            `Style/tone: ${style}.\n` +
            `Writing goals to focus on:\n` +
            writingGoals +
            `For religious (Islam) scripts, keep it respectful, authentic, and avoid controversial topics.\n` +
            'Do not include scene directions, only spoken narration.',
        });
      }

      const stream = await this.client.chat.completions.create({
        model,
        stream: true,
        messages,
      });

      return stream;
    } catch (error) {
      // Surface a clean error to the controller
      throw new InternalServerErrorException(
        'Failed to generate script from OpenAI',
      );
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

      const tryExtractJson = (raw: string): string => {
        const s = String(raw || '').trim();
        if (!s) return s;

        // If the model returned extra text, try to salvage the first JSON block.
        const firstObj = s.indexOf('{');
        const lastObj = s.lastIndexOf('}');
        if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
          return s.slice(firstObj, lastObj + 1).trim();
        }

        const firstArr = s.indexOf('[');
        const lastArr = s.lastIndexOf(']');
        if (firstArr !== -1 && lastArr !== -1 && lastArr > firstArr) {
          return s.slice(firstArr, lastArr + 1).trim();
        }

        return s;
      };

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
          const allNumericKeys = keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
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

      const completion = await this.client.chat.completions.create({
        model,
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
        response_format: { type: 'json_object' },
      });

      const raw = completion.choices[0]?.message?.content;
      if (!raw) {
        throw new Error('Empty response from OpenAI');
      }

      const jsonText = tryExtractJson(raw);
      const parsed = JSON.parse(jsonText) as unknown;
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
      const stream = await this.client.chat.completions.create({
        model,
        stream: true,
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

      return stream;
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to enhance script with OpenAI',
      );
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

    const requiredRoleLine = 'You are an expert editor for short video narration.';
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
      const stream = await this.client.chat.completions.create({
        model,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      });

      return stream;
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to enhance sentence with OpenAI',
      );
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
      const completion = await this.client.chat.completions.create({
        model: this.model,
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
      });

      const title = completion.choices[0]?.message?.content?.trim();
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

    const completion = await this.client.chat.completions.create({
      model: this.model,
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
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      throw new InternalServerErrorException('Empty response from OpenAI');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new InternalServerErrorException('Invalid JSON from OpenAI');
    }

    const title = String(parsed.title ?? '').trim().slice(0, 100);

    const requiredHashtags = '#allah,#islamicshorts,#shorts';
    const requiredLeadingTags = ['allah', 'islamic shorts', 'shorts'];

    const pickShortSentence = (raw: string) => {
      const cleaned = String(raw || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleaned) return 'A quick short with a powerful takeaway.';

      // Take the first sentence-like chunk and keep it short.
      const first = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned;
      const normalized = first.replace(/[\n\r]+/g, ' ').trim();
      if (!normalized) return 'A quick short with a powerful takeaway.';
      const capped = normalized.length > 140 ? normalized.slice(0, 137).trimEnd() + '...' : normalized;
      return capped;
    };

    // Always enforce the shorts description format:
    // Title on first line, one short sentence on second line, required hashtags at the very end.
    const modelDesc = String(parsed.description ?? '').trim();
    const secondLine = pickShortSentence(modelDesc);
    const description = `${title}\n${secondLine}\n\n${requiredHashtags}`.slice(0, 5000);

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
    const tags: string[] = [];

    for (const t of requiredLeadingTags) {
      const normalized = String(t || '').trim().toLowerCase();
      const key = normalized;
      if (!seen.has(key)) {
        tags.push(normalized);
        seen.add(key);
      }
    }

    for (const t of modelTags) {
      const cleaned = String(t || '').trim().toLowerCase();
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

    // OpenAI prompt #1 (classifier): decide whether to enforce male-only characters.
    const mentionsAllahProphetOrSahaba = await this.sentenceMentionsAllahProphetOrSahaba({
      script: fullScriptContext,
      sentence: dto.sentence,
    });

    const noHumanFiguresRule =
      'ABSOLUTE RULE: Do NOT depict any humans or human-like figures. ' +
      'NO people, NO faces, NO heads, NO hands, NO bodies, NO skin, NO silhouettes, NO characters, NO crowds, NO humanoid statues.';

    try {
      let prompt = dto.prompt?.trim();
      console.log('Prompt', prompt);
      console.log('Mentions Allah/Prophet/Sahaba:', mentionsAllahProphetOrSahaba);
      if (!prompt) {
        // First ask the chat model for a detailed image prompt
        const promptCompletion = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            {
              role: 'system',
              content:
                'You are a visual prompt engineer for image generation models. ' +
                'Read the sentence and identify the single most dominant emotion and the most dominant object/action/idea. ' +
                'Your prompt MUST visually express that emotion through composition, lighting, color palette, environment, and symbolism. ' +
                'Make the result composition-rich, varied, imaginative, and cinematic (avoid generic defaults unless the sentence truly calls for it). ' +
                'Focus the prompt around the most important object or action in the sentence. ' +
                'If a full script is provided in the user message, use it ONLY as context to infer the time period, setting, cultural details, and story continuity. ' +
                'Do NOT quote the script, do NOT mention the word "script", and do NOT include spoilers beyond what the sentence implies. ' +
                'Keep visuals representative of the script\'s era/time/context while still centered on the sentence. ' +
                (mentionsAllahProphetOrSahaba
                  ? noHumanFiguresRule : '') +
                'Do NOT mention camera settings unless clearly helpful. ' +
                'Respond with a single prompt sentence only, describing visuals only.',
            },
            {
              role: 'user',
              content:
                (fullScriptContext
                  ? `FULL SCRIPT CONTEXT (use ONLY for era/time/setting/continuity):\n${fullScriptContext}\n\n`
                  : '') +
                `Sentence: "${dto.sentence}"\n` +
                `Desired style: ${style} (anime-style artwork).\n\n` +
                // Safety / theological constraints for religious content
                'Important constraints:\n' +
                '- ABSOLUTELY NO humans/human figures: no people, no faces, no hands, no bodies, no silhouettes.\n' +

                (mentionsAllahProphetOrSahaba
                  ? noHumanFiguresRule : '') +
                'Return only the final image prompt text, with these constraints already applied, and do not include any quotation marks.',
            },
          ],
        });

        prompt =
          promptCompletion.choices[0]?.message?.content?.trim() || dto.sentence;
        console.log('Generated image prompt', prompt);
      } else {
        // Keep consistency with the app's defaults: encourage anime style.
        const wantsAnime = /anime/i.test(style);
        const hasAnime = /anime/i.test(prompt);
        if (wantsAnime && !hasAnime) {
          prompt = `${prompt}, ${style}`;
        }

        const hasNoHumans =
          /\bno\s+(people|humans|human\s+figures?)\b|\bno\s+faces\b|\bno\s+hands\b|\bno\s+silhouettes\b|\bnon[-\s]?figurative\b/i.test(
            prompt,
          );
        if (!hasNoHumans) {
          prompt = `${prompt}, no people, no humans, no faces, no hands, no silhouettes`;
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
  ): Promise<Buffer> {
    const merged = this.mergeSentenceTexts(sentences);
    return this.generateVoiceForScript(merged, voiceId);
  }

  async generateVoiceForScript(
    script: string,
    voiceId?: string,
  ): Promise<Buffer> {
    const text = script?.trim();
    if (!text) {
      throw new BadRequestException(
        'Script text is required to generate voice',
      );
    }

    if (!this.elevenApiKey) {
      throw new InternalServerErrorException(
        'ELEVENLABS_API_KEY is not configured on the server',
      );
    }

    const usedVoiceId = voiceId?.trim() || this.elevenDefaultVoiceId;

    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${usedVoiceId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
            'xi-api-key': this.elevenApiKey,
          },
          body: JSON.stringify({
            text,
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
}
