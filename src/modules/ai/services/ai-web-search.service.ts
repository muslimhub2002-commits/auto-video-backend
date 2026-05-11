import { Injectable } from '@nestjs/common';
import { AiRuntimeService } from './ai-runtime.service';

type AnthropicWebSearchError = {
  status?: number;
  message: string;
};

export type AnthropicWebSearchResult<T> = {
  parsed: T | null;
  error?: AnthropicWebSearchError;
};

@Injectable()
export class AiWebSearchService {
  constructor(private readonly runtime: AiRuntimeService) {}

  getWebSearchModel(preferredModel?: string): string {
    const preferred = String(preferredModel ?? '').trim();
    if (preferred) return preferred;

    const fromEnv = String(process.env.ANTHROPIC_WEB_SEARCH_MODEL ?? '').trim();
    if (fromEnv) return fromEnv;

    const defaultAnthropic = String(
      process.env.ANTHROPIC_DEFAULT_MODEL ?? '',
    ).trim();
    if (defaultAnthropic) return defaultAnthropic;

    return 'claude-sonnet-4-5';
  }

  async completeJson<T>(options: {
    system: string;
    user: string;
    followUpUser?: string;
    model?: string;
    maxTokens?: number;
    followUpMaxTokens?: number;
    temperature?: number;
    retries?: number;
  }): Promise<AnthropicWebSearchResult<T>> {
    const anthropic = this.runtime.anthropic;
    if (!anthropic) {
      return {
        parsed: null,
        error: { message: 'Anthropic web search is not configured.' },
      };
    }

    const model = this.getWebSearchModel(options.model);
    const baseSystem = String(options.system ?? '').trim();
    const user = String(options.user ?? '').trim();
    const followUpUser =
      String(options.followUpUser ?? '').trim() ||
      'Using the web search results above, return ONLY valid JSON.';
    const maxTokens = Number.isFinite(options.maxTokens)
      ? Number(options.maxTokens)
      : 700;
    const followUpMaxTokens = Number.isFinite(options.followUpMaxTokens)
      ? Number(options.followUpMaxTokens)
      : 500;
    const temperature = Number.isFinite(options.temperature)
      ? Number(options.temperature)
      : 0.2;
    const retries = Math.max(1, Math.min(4, Number(options.retries) || 2));

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      const system =
        attempt === 1
          ? baseSystem
          : baseSystem +
            '\n\nIMPORTANT: Your previous response was invalid. Return ONLY valid JSON (no prose, no markdown, no code fences).';

      try {
        const msg: any = await anthropic.messages.create({
          model,
          max_tokens: maxTokens,
          temperature,
          system,
          tools: [
            {
              name: 'web_search',
              type: 'web_search_20250305',
            },
          ],
          messages: [{ role: 'user', content: user }],
        } as any);

        const direct = this.extractJsonFromMessage<T>(msg);
        if (direct) return { parsed: direct };

        const blocks = Array.isArray(msg?.content) ? msg.content : [];
        const stopReason = String(msg?.stop_reason ?? '').trim();
        if (this.hasWebSearchToolResults(blocks) || stopReason === 'tool_use') {
          const followUp: any = await anthropic.messages.create({
            model,
            max_tokens: followUpMaxTokens,
            temperature,
            system,
            messages: [
              { role: 'assistant', content: blocks },
              { role: 'user', content: followUpUser },
            ],
          } as any);

          const parsed = this.extractJsonFromMessage<T>(followUp);
          if (parsed) return { parsed };
        }
      } catch (err: any) {
        const status = Number(err?.status ?? err?.response?.status ?? NaN);
        const message = String(
          err?.message ?? 'Anthropic web_search call failed',
        );

        return {
          parsed: null,
          error: {
            status: Number.isFinite(status) ? status : undefined,
            message,
          },
        };
      }
    }

    return {
      parsed: null,
      error: { message: 'Anthropic web search did not return valid JSON.' },
    };
  }

  private extractJsonFromMessage<T>(message: any): T | null {
    const blocks = Array.isArray(message?.content) ? message.content : [];
    const text = blocks
      .filter((block: any) => block && typeof block.text === 'string')
      .map((block: any) => String(block.text ?? ''))
      .join('')
      .trim();
    if (!text) return null;

    try {
      const jsonText = this.tryExtractJson(text);
      return JSON.parse(jsonText) as T;
    } catch {
      return null;
    }
  }

  private hasWebSearchToolResults(blocks: any[]): boolean {
    return blocks.some(
      (block: any) =>
        block &&
        (block.type === 'web_search_tool_result' ||
          block.type === 'server_tool_use' ||
          block.type === 'web_search_result'),
    );
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
}