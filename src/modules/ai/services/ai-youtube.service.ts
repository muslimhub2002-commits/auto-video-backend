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

  async generateYoutubeSeo(
    script: string,
    options?: { useWebSearch?: boolean },
  ): Promise<{ title: string; description: string; tags: string[] }> {
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
              'Rules: title <= 100 chars, description <= 5000 chars, tags: 3-5 items, each tag <= 30 chars, no emojis. ' +
              'This video is a SHORT: the description MUST start with the exact title on its own line, followed by ONE short sentence on the next line. ' +
              'At the very end of the description, append this exact string: #allah,#islamicShorts,#shorts',
          },
          {
            role: 'user',
            content:
              'Generate YouTube SEO metadata for this video script. ' +
              'The title should be compelling and keyword-rich. ' +
              'The description must follow the SHORT format: title line + one short sentence, then end with the required hashtags. ' +
              'Tags should be relevant and specific (mix broad + long-tail). Return 3-5 tags max.\n\n' +
              trimmed,
          },
        ],
      });
    } catch {
      throw new InternalServerErrorException('Invalid JSON from the model');
    }

    const title = `${String(parsed.title ?? '')} #allah #shorts`;

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
    pickShortSentence(modelDesc);

    const description = `${title}`;

    const llmFallbackTags = Array.isArray(parsed.tags)
      ? parsed.tags.map((t: any) => String(t ?? ''))
      : [];

    const useWebSearch =
      options?.useWebSearch !== undefined
        ? Boolean(options.useWebSearch)
        : true;
    const webTags = useWebSearch
      ? await this.tryGetViralTagsViaClaudeWebSearch(trimmed)
      : [];

    const tags = await this.buildFinalYoutubeTags({
      script: trimmed,
      primary: ['Allah', 'Islamic Shorts', ...webTags],
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
