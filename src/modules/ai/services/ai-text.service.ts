import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { GenerateScriptDto } from '../dto/generate-script.dto';
import { EnhanceScriptDto } from '../dto/enhance-script.dto';
import { EnhanceSentenceDto } from '../dto/enhance-sentence.dto';
import type { LlmMessage } from '../llm/llm-types';
import { AiRuntimeService } from './ai-runtime.service';

@Injectable()
export class AiTextService {
  // Narration pacing assumption (words per minute) used to derive strict word-count targets.
  private readonly narrationWpm = 150;

  constructor(private readonly runtime: AiRuntimeService) {}

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

  async createScriptStream(options: GenerateScriptDto) {
    const subject = options.subject?.trim() || 'religious (Islam)';
    const subjectContent = options.subjectContent?.trim();
    const length = options.length?.trim() || '1 minute';
    const style = options.style?.trim() || 'Conversational';
    const technique = this.normalizeTechnique(options.technique);
    const model = options.model?.trim() || this.model;
    const customSystemPrompt = options.systemPrompt?.trim() || '';
    const wordRange = this.getStrictWordRange(length);

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

          messages.push({ role: 'assistant', content: ref.script });
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

      return this.llm.streamText({ model, messages, maxTokens: 2500 });
    } catch {
      throw new InternalServerErrorException('Failed to generate script');
    }
  }

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

          const maybeSentences = (obj as any).sentences;
          if (Array.isArray(maybeSentences)) {
            return maybeSentences.map((v) => String(v).trim()).filter(Boolean);
          }

          const keys = Object.keys(obj);
          const allNumericKeys =
            keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
          if (allNumericKeys) {
            return keys
              .sort((a, b) => Number(a) - Number(b))
              .map((k) => String((obj as any)[k] ?? '').trim())
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

      const splitterSystemPrompt = [requiredSplitterPrompt].filter(Boolean).join('\n');

      const parsed = await this.llm.completeJson<unknown>({
        model,
        temperature: 0,
        maxTokens: 1500,
        retries: 2,
        messages: [
          { role: 'system', content: splitterSystemPrompt },
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
    } catch {
      throw new InternalServerErrorException('Failed to split script into sentences');
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
      (userPrompt ? `User instruction for the rewrite: ${userPrompt}\n\n` : '') +
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

  async createVoiceStyleInstructionsStream(dto: { script: string; model?: string }) {
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
          content: 'SCRIPT (derive voice style/tone instructions from this):\n' + script,
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
                'Generate a short, catchy title (max 8 words) for this script:\n\n' + trimmed,
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

  async generateYoutubeSeo(script: string): Promise<{ title: string; description: string; tags: string[] }> {
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

    const title = String(parsed.title ?? '').trim().slice(0, 100);
    const requiredHashtags = '#allah,#shorts';

    const pickShortSentence = (raw: string) => {
      const cleaned = String(raw || '').replace(/\s+/g, ' ').trim();
      if (!cleaned) return 'A quick short with a powerful takeaway.';

      const first = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned;
      const normalized = first.replace(/[\n\r]+/g, ' ').trim();
      if (!normalized) return 'A quick short with a powerful takeaway.';
      return normalized.length > 140 ? normalized.slice(0, 137).trimEnd() + '...' : normalized;
    };

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
      const cleaned = String(t || '').trim().toLowerCase();
      if (!cleaned) continue;
      if (seen.has(cleaned)) continue;
      tags.push(cleaned);
      seen.add(cleaned);
      if (tags.length >= 25) break;
    }

    if (!title) {
      throw new InternalServerErrorException('OpenAI returned empty title');
    }

    return { title, description, tags };
  }
}
