import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { GenerateScriptDto } from '../dto/generate-script.dto';
import { EnhanceScriptDto } from '../dto/enhance-script.dto';
import { EnhanceSentenceDto } from '../dto/enhance-sentence.dto';
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
      text: string;
      characterKeys: string[];
      eraKey: string | null;
    }>;
    characters: Array<{
      key: string;
      name: string;
      description: string;
      isSahaba: boolean;
      isProphet: boolean;
      isWoman: boolean;
    }>;
    eras: Array<{
      key: string;
      name: string;
      description?: string;
    }>;
  }> {
    try {
      const script = dto.script;
      const model = dto.model?.trim() || this.model;

      type ScriptCharacter = {
        key: string;
        name: string;
        description: string;
        isSahaba: boolean;
        isProphet: boolean;
        isWoman: boolean;
      };

      type ScriptEra = {
        key: string;
        name: string;
        description?: string;
      };

      const normalizeSentenceItems = (
        parsed: unknown,
        validCharacterKeys: Set<string>,
        validEraKeys: Set<string>,
      ): Array<{
        text: string;
        characterKeys: string[];
        eraKey: string | null;
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
          eraKey: string | null;
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

          const eraKeyRaw = String((item as any).eraKey ?? '')
            .trim()
            .toUpperCase();
          const eraKey =
            eraKeyRaw && validEraKeys.has(eraKeyRaw) ? eraKeyRaw : null;

          out.push({ text, characterKeys, eraKey });
        }

        return out;
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

      const normalizeEras = (parsed: unknown): ScriptEra[] => {
        const raw =
          parsed &&
          typeof parsed === 'object' &&
          Array.isArray((parsed as any).eras)
            ? ((parsed as any).eras as unknown[])
            : [];

        const out: ScriptEra[] = [];
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
        '- Each character.description MUST include facial + physical attributes for consistency unless it is a Prophet or Sahaba or a Woman.\n' +
        '- For any character with isProphet=true or isSahaba=true (except an Army): DO NOT describe face details (no eyes/nose/mouth). Write the description to be safe for BACK VIEW depiction only (physique + clothing + silhouette).\n' +
        '- Character keys must be short like C1, C2, C3... in first-appearance order.\n' +
        '- If unsure about any boolean flag, set it to false.\n' +
        '- No extra keys. No extra text.';

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
              script,
          },
        ],
      });

      const characters = normalizeCharacters(parsedCharacters);

      const requiredErasPrompt =
        'You extract the different canonical ERAS periods from a narration script.\n' +
        'Always respond with pure JSON as an OBJECT with exactly this shape: ' +
        '{"eras": [{"key": string, "name": string, "description"?: string}]}\n\n' +
        'Rules:\n' +
        '- Extract the different canonical ERAS that are relevant to the story.\n' +
        '- Use keys E1, E2, E3... (do NOT use E0).\n' +
        '- Keep era.name short (e.g. "7th century Arabia", "Ottoman era", "Modern day").\n' +
        '- The description should include any important contextual details for that era that could impact visual depiction (environment, lighting, color tone).\n';
      "- Don't add in the description any human or character details; focus only on era-specific environment/atmospheric details.\n" +
        '- If the script implies a time progression, assign eras accordingly. If the era is ambiguous or not visually distinct, it can be null.\n';

      const parsedEras = await this.llm.completeJson<unknown>({
        model,
        retries: 2,
        messages: [
          { role: 'system', content: requiredErasPrompt },
          {
            role: 'user',
            content:
              'Return ONLY valid JSON in this exact shape: ' +
              '{"eras": [{"key":"E1","name":"...","description":"..."}]}\n\n' +
              script,
          },
        ],
      });

      const eras = normalizeEras(parsedEras);

      const requiredSplitAndTagPrompt =
        'You split a script into clean sentences (verbatim) and tag each sentence with character keys + an era key.\n' +
        'You are given canonical CHARACTERS and ERAS with keys. Use ONLY those keys.\n' +
        'Always respond with pure JSON as an OBJECT with exactly this shape: ' +
        '{"sentences": [{"text": string, "characterKeys": string[], "eraKey": string | null}]}\n\n' +
        'Rules:\n' +
        '- Do NOT add/remove/rewrite words; only split into sentences. Sentence text MUST match the script wording verbatim.\n' +
        '- characterKeys must be a subset of the provided character keys (or empty).\n' +
        '- If a sentence describes a battle/fight/combat moment, include the relevant GROUP/ARMY character keys for the sides involved (in addition to any named protagonists mentioned).\n' +
        '- eraKey must be one of the provided era keys OR null.\n' +
        '- Infer an era ONLY if the TARGET sentence clearly implies a time period (explicitly or via strong cues).\n' +
        '- Use script context only to resolve references/pronouns for the target sentence.\n' +
        '- If the sentence does NOT imply a clear era, set eraKey to null (do NOT guess).\n' +
        '- No extra keys. No extra text.';

      const charactersList = characters
        .map((c) => `${c.key}: ${c.name} — ${c.description}`)
        .join('\n');

      const erasList = eras
        .map(
          (e) =>
            `${e.key}: ${e.name}${e.description ? ` — ${e.description}` : ''}`,
        )
        .join('\n');

      const parsedSentences = await this.llm.completeJson<unknown>({
        model,
        retries: 2,
        messages: [
          { role: 'system', content: requiredSplitAndTagPrompt },
          {
            role: 'user',
            content:
              'Return ONLY valid JSON in this exact shape: ' +
              '{"sentences": [{"text":"...","characterKeys":["C1"],"eraKey":"E1"}]}\n\n' +
              'CANONICAL CHARACTERS (use ONLY these keys):\n' +
              (charactersList ? charactersList : '(none)') +
              '\n\n' +
              'CANONICAL ERAS (use ONLY these keys):\n' +
              (erasList ? erasList : '(none)') +
              '\n\n' +
              'SCRIPT (split + tag):\n' +
              script,
          },
        ],
      });

      const validCharacterKeys = new Set(characters.map((c) => c.key));
      const validEraKeys = new Set(eras.map((e) => e.key));

      const sentences = normalizeSentenceItems(
        parsedSentences,
        validCharacterKeys,
        validEraKeys,
      );
      if (!sentences.length) {
        throw new Error('Invalid JSON structure for sentences');
      }

      return { sentences, characters, eras };
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
