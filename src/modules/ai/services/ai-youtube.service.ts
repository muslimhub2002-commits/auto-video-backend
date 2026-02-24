import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { AiRuntimeService } from './ai-runtime.service';

@Injectable()
export class AiYoutubeService {
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

  async generateYoutubeWallpaperPrompt(params: {
    script: string;
    title?: string;
    promptModel?: string;
    safeCharacters?: Array<{ key: string; name: string; description: string }>;
  }): Promise<{ headline: string; prompt: string; characterKeys: string[] }> {
    const trimmed = String(params?.script ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('Script is required');
    }

    const title = String(params?.title ?? '').trim();

    const promptModelRaw = String(params?.promptModel ?? '').trim();
    const model = promptModelRaw || this.model;

    const safeChars = Array.isArray(params?.safeCharacters)
      ? params.safeCharacters
        .map((c) => ({
          key: String(c?.key ?? '').trim(),
          name: String(c?.name ?? '').trim(),
          description: String(c?.description ?? '').trim(),
        }))
        .filter((c) => c.key && c.name && c.description)
        .slice(0, 12)
      : [];

    const safeCharBlock = safeChars.length
      ? 'SAFE CHARACTERS (ONLY these may be depicted as humans):\n' +
      safeChars
        .map((c) => `- ${c.key}: ${c.name} — ${c.description}`)
        .join('\n')
      : 'SAFE CHARACTERS: (none provided)';

    let parsed: any;
    try {
      parsed = await this.llm.completeJson<any>({
        model,
        temperature: 0.6,
        maxTokens: 900,
        retries: 2,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert YouTube thumbnail / wallpaper prompt engineer.\n' +
              'You generate a SINGLE image prompt for a 16:9 YouTube wallpaper that maximizes click-through.\n' +
              'Return ONLY valid JSON with the exact shape: ' +
              '{"headline": string, "prompt": string, "characterKeys": string[]}.\n\n' +
              'Thumbnail Visual Stunt approach (MUST follow):\n' +
              '- Use color science: bright/vivid foreground colors that POP against a contrasting background (high visual contrast).\n' +
              '- Include a LARGE face / close-up subject in the image (dominant focal point).\n' +
              '- Add at least ONE visually compelling graphic element (e.g., glow, arrows, icons, shapes, burst, rim light, dramatic outline).\n' +
              '- Use LARGE headline text in the background (big, readable, high contrast).\n\n' +
              'Title vs headline rules:\n' +
              '- If a video TITLE is provided: the headline text MUST NOT be identical to the title and MUST NOT copy the title verbatim.\n' +
              '- Instead, the headline should CONFIRM/REINFORCE the title with a different interesting sentence (e.g., a proof, a consequence, or a surprising confirmation).\n\n' +
              'Core constraints:\n' +
              '- The wallpaper is 16:9, ultra sharp, high contrast, cinematic.\n' +
              '- MUST include readable headline text in the image: a short, punchy line (roughly 3-10 words).\n' +
              '- MUST include blur elements (e.g., blurred background, depth-of-field, bokeh) to make foreground pop.\n' +
              '- MUST be a full illustrative scene of the subject (not an icon).\n' +
              '- Composition: rule of thirds, clear focal subject, clean negative space.\n' +
              '- Avoid clutter; prioritize clarity and curiosity.\n' +
              '- Only depict human characters if they are listed in SAFE CHARACTERS.\n' +
              '- characterKeys must be a subset of SAFE CHARACTERS keys (0-3 keys).\n' +
              '- The prompt MUST repeat the headline text exactly in quotes, like: Headline text: "...".\n' +
              '- The prompt MUST explicitly instruct: (1) large face close-up, (2) vivid contrasting colors, (3) one graphic element, (4) large background text.\n',
          },
          {
            role: 'user',
            content:
              'Generate a YouTube wallpaper prompt for this script.\n\n' +
              (title ? `VIDEO TITLE (do NOT copy this text as the headline):\n${title}\n\n` : '') +
              safeCharBlock +
              '\n\nSCRIPT:\n' +
              trimmed,
          },
        ],
      });
    } catch {
      throw new InternalServerErrorException('Invalid JSON from the model');
    }

    const headline = String(parsed?.headline ?? '').trim();
    const prompt = String(parsed?.prompt ?? '').trim();
    const characterKeysRaw = Array.isArray(parsed?.characterKeys)
      ? parsed.characterKeys
      : [];
    const characterKeys = characterKeysRaw
      .map((k: any) => String(k ?? '').trim())
      .filter(Boolean)
      .filter((k: string) => safeChars.some((c) => c.key === k))
      .slice(0, 3);

    if (!headline) {
      throw new InternalServerErrorException('Model returned empty headline');
    }
    if (!prompt) {
      throw new InternalServerErrorException('Model returned empty prompt');
    }

    return { headline, prompt, characterKeys };
  }

  async generateYoutubeSeo(
    script: string,
    options?: { useWebSearch?: boolean; isShort?: boolean },
  ): Promise<{ title: string; description: string; tags: string[] }> {
    const trimmed = script?.trim();
    if (!trimmed) {
      throw new BadRequestException('Script is required');
    }

    const isShort =
      options?.isShort !== undefined ? Boolean(options.isShort) : true;

    const useWebSearch =
      options?.useWebSearch !== undefined
        ? Boolean(options.useWebSearch)
        : true;

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
              'Rules: title <= 100 chars, description <= 5000 chars, tags: 3-5 items, each tag <= 30 chars, no emojis. ' +
              (isShort
                ? 'This video is a SHORT. Return a strong base title (no hashtags) and a one-sentence description idea (no hashtags). '
                : 'This is a REGULAR (not short) YouTube video. Return a strong base title (no hashtags) and a LONG SEO description (2-4 short paragraphs) that is NOT the same as the title. Do NOT append hashtags to the title.'),
          },
          {
            role: 'user',
            content:
              'Generate YouTube SEO metadata for this video script. ' +
              'The title should be compelling and keyword-rich. ' +
              (isShort
                ? 'This is a SHORT. Provide a base title (no hashtags) and a one-sentence description idea (no hashtags). '
                : 'This is a regular long-form video. Provide a base title (no hashtags) and a long SEO description (2-4 short paragraphs) that is NOT the same as the title. ') +
              'Tags should be relevant and specific (mix broad + long-tail). Return 3-5 tags max.\n\n' +
              trimmed,
          },
        ],
      });
    } catch {
      throw new InternalServerErrorException('Invalid JSON from the model');
    }

    const baseTitle = String(parsed.title ?? '').trim();

    // Shorts keep the hashtags; regular videos do not.
    const title = isShort ? `${baseTitle} #allah #shorts` : baseTitle;

    const pickShortSentence = (raw: string) => {
      const cleaned = String(raw || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleaned) return 'A quick short with a powerful takeaway.';

      const first = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned;
      const normalized = first.replace(/[\n\r]+/g, ' ').trim();
      if (!normalized) return 'A quick short with a powerful takeaway.';
      return normalized.length > 140
        ? normalized.slice(0, 137).trimEnd() + '...'
        : normalized;
    };

    const modelDesc = String(parsed.description ?? '').trim();

    const description = (() => {
      if (isShort) {
        const shortSentence = pickShortSentence(modelDesc);
        return `${title}\n${shortSentence}\n\n#allah,#islamicShorts,#shorts`;
      }

      // Long-form: a separate long SEO description (not equal to the title).
      if (!modelDesc) {
        return (
          'Watch the full video for the complete story and key lessons.\n\n' +
          'In this video, we break down the topic step-by-step with clear takeaways and practical context.'
        );
      }

      if (modelDesc.trim().toLowerCase() === title.trim().toLowerCase()) {
        return `${modelDesc}\n\nIn this video, we expand on the title with deeper context, key moments, and a clear takeaway.`;
      }

      return modelDesc;
    })();

    const llmFallbackTags = Array.isArray(parsed.tags)
      ? parsed.tags.map((t: any) => String(t ?? ''))
      : [];

    const webTags = useWebSearch
      ? await this.tryGetViralTagsViaClaudeWebSearch(trimmed)
      : [];

    const tags = await this.buildFinalYoutubeTags({
      script: trimmed,
      primary: isShort
        ? ['Allah', 'Islamic Shorts', ...webTags]
        : ['Allah', 'Islamic Stories', ...webTags],
      fallback: llmFallbackTags,
      min: 3,
      max: 5,
    });

    if (!title) {
      throw new InternalServerErrorException('OpenAI returned empty title');
    }

    return { title, description, tags };
  }

  private tryExtractJson(raw: string): string {
    const s = String(raw || '').trim();
    if (!s) return s;

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
  }

  private normalizeYoutubeTag(raw: string): string | null {
    const s = String(raw ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) return null;
    const noHash = s.replace(/^#+/, '').trim();
    if (!noHash) return null;
    const lowered = noHash.toLowerCase();
    const clipped =
      lowered.length > 30 ? lowered.slice(0, 30).trimEnd() : lowered;
    return clipped || null;
  }

  private uniqCaseInsensitive(tags: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const t of tags) {
      const norm = String(t ?? '').trim();
      if (!norm) continue;
      const key = norm.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(norm);
    }
    return out;
  }

  private getAnthropicWebSearchModel(): string {
    const fromEnv = String(process.env.ANTHROPIC_WEB_SEARCH_MODEL ?? '').trim();
    if (fromEnv) return fromEnv;

    const defaultAnthropic = String(
      process.env.ANTHROPIC_DEFAULT_MODEL ?? '',
    ).trim();
    if (defaultAnthropic) return defaultAnthropic;

    return 'claude-sonnet-4-5';
  }

  private async tryGetViralTagsViaClaudeWebSearch(
    script: string,
  ): Promise<string[]> {
    const anthropic = this.runtime.anthropic;
    if (!anthropic) return [];

    // If Anthropic's web_search tool is not enabled for the account/model, this will throw.
    // Always use Anthropic here (ignore the UI-selected model).
    const model = this.getAnthropicWebSearchModel();

    const baseSystem =
      'You are an expert YouTube growth strategist and SEO tag researcher.\n' +
      'You have access to a web search tool. Use it to find currently viral / trending tags and keywords relevant to the provided script topic.\n' +
      'Return ONLY valid JSON with this exact shape: {"tags": string[]}.\n' +
      'Constraints for tags:\n' +
      '- 3 to 5 tags total\n' +
      '- No leading #\n' +
      '- Each tag <= 30 characters\n' +
      '- Tags must be highly relevant to the script content (no generic unrelated viral tags).\n' +
      '- Mix broad + long-tail where possible.';

    const userMsg =
      'Find the most viral and relevant YouTube tags for this script.\n' +
      'Do web search first, then decide the best tags.\n\n' +
      'SCRIPT:\n' +
      script;

    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const system =
        attempt === 1
          ? baseSystem
          : baseSystem +
          '\n\nIMPORTANT: Your previous response was invalid. Return ONLY valid JSON (no prose, no markdown, no code fences).';

      try {
        const msg: any = await anthropic.messages.create({
          model,
          max_tokens: 700,
          temperature: 0.2,
          system,
          tools: [
            {
              name: 'web_search',
              type: 'web_search_20250305',
            },
          ],
          messages: [{ role: 'user', content: userMsg }],
        } as any);

        const extractTagsFromMessage = (m: any): string[] | null => {
          const blocks = Array.isArray(m?.content) ? m.content : [];
          const text = blocks
            .filter((b: any) => b && typeof b.text === 'string')
            .map((b: any) => String(b.text ?? ''))
            .join('')
            .trim();
          if (!text) return null;

          const jsonText = this.tryExtractJson(text);
          const parsed = JSON.parse(jsonText);
          const rawTags = Array.isArray(parsed?.tags) ? parsed.tags : [];
          const normalized = rawTags
            .map((t: any) => this.normalizeYoutubeTag(String(t ?? '')))
            .filter(Boolean) as string[];

          const unique = this.uniqCaseInsensitive(normalized);
          return unique.length ? unique : null;
        };

        // If Claude already returned JSON tags, use them.
        const direct = extractTagsFromMessage(msg);
        if (direct && direct.length >= 3) return direct.slice(0, 5);

        // Web search is a *server tool*; the first response may contain only tool-result blocks.
        // If so, do a follow-up call that consumes the tool results and asks for the final JSON.
        const blocks = Array.isArray(msg?.content) ? msg.content : [];
        const hasWebToolResults = blocks.some(
          (b: any) =>
            b &&
            (b.type === 'web_search_tool_result' ||
              b.type === 'server_tool_use' ||
              b.type === 'web_search_result'),
        );

        const stopReason = String(msg?.stop_reason ?? '').trim();
        if (hasWebToolResults || stopReason === 'tool_use') {
          const followUp: any = await anthropic.messages.create({
            model,
            max_tokens: 500,
            temperature: 0.2,
            system,
            messages: [
              { role: 'assistant', content: blocks },
              {
                role: 'user',
                content:
                  'Using the web search results above, return ONLY valid JSON as {"tags": string[]}. ' +
                  'Constraints: 3-5 tags, no leading #, each <= 30 chars, only relevant to the script topic.',
              },
            ],
          } as any);

          const fromFollowUp = extractTagsFromMessage(followUp);
          if (fromFollowUp && fromFollowUp.length >= 5)
            return fromFollowUp.slice(0, 5);
        }
      } catch (err: any) {
        const status = Number(err?.status ?? err?.response?.status ?? NaN);
        const message = String(
          err?.message ?? 'Anthropic web_search call failed',
        );
        // Keep behavior: fallback to non-web tags, but log enough to debug.
        console.warn('[ai] web_search tags failed', {
          status: Number.isFinite(status) ? status : undefined,
          message,
        });
        return [];
      }
    }

    return [];
  }

  private async buildFinalYoutubeTags(options: {
    script: string;
    primary: string[] | null;
    fallback: string[];
    min: number;
    max: number;
  }): Promise<string[]> {
    const sanitizeList = (list: string[]) =>
      this.uniqCaseInsensitive(
        (list || [])
          .map((t) => this.normalizeYoutubeTag(t))
          .filter(Boolean) as string[],
      );

    const primary = options.primary ? sanitizeList(options.primary) : [];
    const fallback = sanitizeList(options.fallback);

    let out = primary.slice(0, options.max);

    if (out.length < options.min) {
      for (const t of fallback) {
        if (out.length >= options.max) break;
        const key = t.toLowerCase();
        if (out.some((x) => x.toLowerCase() === key)) continue;
        out.push(t);
      }
    }

    if (out.length < options.min) {
      const needed = options.min - out.length;
      const extracted = await this.tryExtractScriptKeywordTags(
        options.script,
        Math.max(needed, 3),
      );
      for (const t of extracted) {
        if (out.length >= options.max) break;
        const key = t.toLowerCase();
        if (out.some((x) => x.toLowerCase() === key)) continue;
        out.push(t);
      }
    }

    out = this.uniqCaseInsensitive(out).slice(0, options.max);

    // Absolute guarantee: return 3-5 tags whenever possible.
    // If we still have too few, pad with safe script-derived tokens.
    if (out.length < options.min) {
      const pad = await this.tryExtractScriptKeywordTags(
        options.script,
        options.min,
      );
      for (const t of pad) {
        if (out.length >= options.min) break;
        const key = t.toLowerCase();
        if (out.some((x) => x.toLowerCase() === key)) continue;
        out.push(t);
      }
    }

    return this.uniqCaseInsensitive(out).slice(
      0,
      Math.max(options.min, options.max),
    );
  }

  private async tryExtractScriptKeywordTags(
    script: string,
    count: number,
  ): Promise<string[]> {
    const safeCount = Math.max(3, Math.min(10, Number(count) || 5));

    try {
      const parsed = await this.llm.completeJson<{ tags: string[] }>({
        model: this.cheapModel,
        temperature: 0.2,
        maxTokens: 400,
        retries: 1,
        messages: [
          {
            role: 'system',
            content:
              'You extract YouTube tags from a narration script. ' +
              'Return ONLY valid JSON: {"tags": string[]}. ' +
              `Return ${safeCount} tags. ` +
              'Constraints: no leading #, each tag <= 30 chars, highly relevant to the script.',
          },
          { role: 'user', content: script },
        ],
      });

      const tags = Array.isArray(parsed?.tags) ? parsed.tags : [];
      return this.uniqCaseInsensitive(
        tags
          .map((t: any) => this.normalizeYoutubeTag(String(t ?? '')))
          .filter(Boolean) as string[],
      ).slice(0, safeCount);
    } catch {
      // last resort: lightweight heuristic
      const stop = new Set([
        'this',
        'that',
        'with',
        'from',
        'your',
        'you',
        'they',
        'their',
        'about',
        'what',
        'when',
        'where',
        'have',
        'has',
        'will',
        'just',
        'like',
        'into',
        'over',
        'than',
        'then',
        'them',
        'some',
        'more',
        'most',
        'very',
        'only',
        'dont',
        "don't",
      ]);

      const words = script
        .toLowerCase()
        .replace(/[^a-z0-9\s]/gi, ' ')
        .split(/\s+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 5)
        .filter((w) => !stop.has(w));

      const freq = new Map<string, number>();
      for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);

      const sorted = [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([w]) => w)
        .slice(0, safeCount);

      return sorted.map((w) => w.slice(0, 30));
    }
  }
}
