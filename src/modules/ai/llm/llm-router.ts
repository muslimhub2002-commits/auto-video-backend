import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import type {
  LlmCompleteJsonParams,
  LlmCompleteParams,
  LlmMessage,
  LlmStreamParams,
} from './llm-types';

const isAnthropicModel = (model: string) => /^claude-/i.test(model || '');
const isGeminiModel = (model: string) => /^gemini-/i.test(model || '');

const prefersMaxCompletionTokens = (model: string): boolean => {
  const m = /^gpt-(\d+)/i.exec(String(model || '').trim());
  if (!m) return false;
  const major = Number(m[1]);
  return Number.isFinite(major) && major >= 5;
};

const splitSystemMessages = (messages: LlmMessage[]) => {
  const systemParts: string[] = [];
  const nonSystem: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const m of messages || []) {
    const role = m?.role;
    const content = String(m?.content ?? '');
    if (!content.trim()) continue;

    if (role === 'system') {
      systemParts.push(content);
    } else if (role === 'user' || role === 'assistant') {
      nonSystem.push({ role, content });
    }
  }

  return {
    system: systemParts.join('\n\n').trim() || undefined,
    messages: nonSystem,
  };
};

const toGeminiContents = (messages: LlmMessage[]) => {
  const { system, messages: nonSystem } = splitSystemMessages(messages);

  const contents = nonSystem.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  return { systemText: system, contents };
};

const extractAnthropicText = (message: Anthropic.Message): string => {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  const texts = blocks
    .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text);
  return texts.join('');
};

const tryExtractJson = (raw: string): string => {
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
};

export class LlmRouter {
  private readonly gemini: GoogleGenerativeAI | null;

  constructor(
    private readonly deps: {
      openai: OpenAI | null;
      anthropic: Anthropic | null;
      geminiApiKey?: string | null;
    },
  ) {
    const key = (deps.geminiApiKey ?? '').trim();
    this.gemini = key ? new GoogleGenerativeAI(key) : null;
  }

  async *streamText(params: LlmStreamParams): AsyncIterable<string> {
    const model = String(params.model || '').trim();
    const maxTokens = Number.isFinite(params.maxTokens)
      ? Number(params.maxTokens)
      : 2048;

    if (isGeminiModel(model)) {
      if (!this.gemini) {
        throw new Error(
          'GEMINI_API_KEY is not set, but a Gemini model was requested.',
        );
      }

      const { systemText, contents } = toGeminiContents(params.messages);

      // @google/generative-ai expects systemInstruction as a Content object.
      const generativeModel = this.gemini.getGenerativeModel({
        model,
        ...(systemText
          ? {
              systemInstruction: {
                role: 'system',
                parts: [{ text: systemText }],
              },
            }
          : {}),
      } as any);

      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const commonPrefixLength = (a: string, b: string): number => {
        const max = Math.min(a.length, b.length);
        let i = 0;
        while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
        return i;
      };

      let streamedSoFar = '';
      let yieldedAny = false;

      // Gemini streaming can fail fast with 429/404. Retry a couple of times on 429.
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const result = await generativeModel.generateContentStream({
            contents,
            generationConfig: {
              temperature: params.temperature,
              maxOutputTokens: maxTokens,
            },
          } as any);

          for await (const chunk of result.stream as any) {
            const text =
              typeof chunk?.text === 'function'
                ? String(chunk.text() ?? '')
                : '';
            if (text) {
              streamedSoFar += text;
              yieldedAny = true;
              yield text;
            }
          }

          break;
        } catch (err: any) {
          const status = Number(err?.status ?? err?.response?.status ?? NaN);
          const message = String(err?.message ?? 'Gemini request failed');

          if (status === 404) {
            throw new Error(
              `Gemini model "${model}" is not available for this API key or does not support streaming. ` +
                'Pick a different Gemini model (e.g. gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash).',
            );
          }

          if (status === 429 && attempt < maxAttempts) {
            const backoffMs = 500 * Math.pow(2, attempt - 1);
            await sleep(backoffMs);
            continue;
          }

          // If the stream fails mid-way (common: "Failed to parse stream"), try to salvage by
          // fetching a non-stream completion and emitting the remaining suffix.
          const isParseStream = /failed to parse stream/i.test(message);
          if (isParseStream) {
            try {
              const full = await this.completeText({
                model,
                messages: params.messages,
                temperature: params.temperature,
                maxTokens,
              });

              if (!yieldedAny) {
                if (full) yield full;
                return;
              }

              const prefixLen = commonPrefixLength(streamedSoFar, full);
              const remainder = full.slice(prefixLen);
              if (remainder) yield remainder;
              return;
            } catch (fallbackErr: any) {
              // Fall through to throwing the original error if fallback fails.
              console.error('Gemini stream fallback failed:', fallbackErr);
            }
          }

          // Re-throw original error for other statuses.
          throw new Error(message);
        }
      }

      return;
    }

    if (isAnthropicModel(model)) {
      if (!this.deps.anthropic) {
        throw new Error(
          'ANTHROPIC_API_KEY is not set, but an Anthropic model was requested.',
        );
      }

      const { system, messages } = splitSystemMessages(params.messages);

      const stream = await this.deps.anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        temperature: params.temperature,
        system,
        messages,
        stream: true,
      });

      for await (const event of stream as any) {
        if (
          event?.type === 'content_block_delta' &&
          event?.delta?.type === 'text_delta'
        ) {
          const text = String(event.delta.text ?? '');
          if (text) yield text;
        }
      }

      return;
    }

    if (!this.deps.openai) {
      throw new Error(
        'OPENAI_API_KEY is not set, but an OpenAI model was requested.',
      );
    }

    const openAiTokenParam = prefersMaxCompletionTokens(model)
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens };

    const stream: any = await this.deps.openai.chat.completions.create({
      model,
      stream: true,
      messages: params.messages as any,
      temperature: params.temperature,
      ...(openAiTokenParam as any),
    });

    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content ?? '';
      if (content) yield content;
    }
  }

  async completeText(params: LlmCompleteParams): Promise<string> {
    const model = String(params.model || '').trim();
    const maxTokens = Number.isFinite(params.maxTokens)
      ? Number(params.maxTokens)
      : 2048;

    if (isGeminiModel(model)) {
      if (!this.gemini) {
        throw new Error(
          'GEMINI_API_KEY is not set, but a Gemini model was requested.',
        );
      }

      const { systemText, contents } = toGeminiContents(params.messages);
      const generativeModel = this.gemini.getGenerativeModel({
        model,
        ...(systemText
          ? {
              systemInstruction: {
                role: 'system',
                parts: [{ text: systemText }],
              },
            }
          : {}),
      } as any);

      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const maxAttempts = 3;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const result = await generativeModel.generateContent({
            contents,
            generationConfig: {
              temperature: params.temperature,
              maxOutputTokens: maxTokens,
            },
          } as any);

          return String(result?.response?.text?.() ?? '');
        } catch (err: any) {
          const status = Number(err?.status ?? err?.response?.status ?? NaN);
          const message = String(err?.message ?? 'Gemini request failed');

          if (status === 404) {
            throw new Error(
              `Gemini model "${model}" is not available for this API key or does not support generateContent. ` +
                'Pick a different Gemini model (e.g. gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash).',
            );
          }

          if (status === 429 && attempt < maxAttempts) {
            const backoffMs = 500 * Math.pow(2, attempt - 1);
            await sleep(backoffMs);
            continue;
          }

          throw new Error(message);
        }
      }

      return '';
    }

    if (isAnthropicModel(model)) {
      if (!this.deps.anthropic) {
        throw new Error(
          'ANTHROPIC_API_KEY is not set, but an Anthropic model was requested.',
        );
      }

      const { system, messages } = splitSystemMessages(params.messages);
      const msg = await this.deps.anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        temperature: params.temperature,
        system,
        messages,
      });

      return extractAnthropicText(msg);
    }

    if (!this.deps.openai) {
      throw new Error(
        'OPENAI_API_KEY is not set, but an OpenAI model was requested.',
      );
    }

    const openAiTokenParam = prefersMaxCompletionTokens(model)
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens };

    const completion = await this.deps.openai.chat.completions.create({
      model,
      messages: params.messages as any,
      temperature: params.temperature,
      ...(openAiTokenParam as any),
    });

    return String(completion.choices?.[0]?.message?.content ?? '');
  }

  async completeJson<T = any>(params: LlmCompleteJsonParams): Promise<T> {
    const retries = Number.isFinite(params.retries)
      ? Number(params.retries)
      : 2;

    // For OpenAI we can use strict JSON mode; for Anthropic/Gemini, enforce via prompt + parse.
    const model = String(params.model || '').trim();

    if (isGeminiModel(model)) {
      const baseMessages = (params.messages || []).slice();

      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const attemptMessages: LlmMessage[] = baseMessages.slice();

        if (attempt > 0) {
          attemptMessages.unshift({
            role: 'system',
            content:
              'IMPORTANT: Your previous response was invalid JSON. ' +
              'Return ONLY valid JSON. No prose, no markdown, no code fences.',
          });
        }

        const text = await this.completeText({
          model,
          messages: attemptMessages,
          temperature: params.temperature,
          maxTokens: params.maxTokens ?? 2048,
        });

        const jsonText = tryExtractJson(text);
        try {
          return JSON.parse(jsonText) as T;
        } catch (err) {
          if (attempt >= retries) throw err;
        }
      }

      throw new Error('Failed to produce valid JSON');
    }

    if (!isAnthropicModel(model)) {
      if (!this.deps.openai) {
        throw new Error(
          'OPENAI_API_KEY is not set, but an OpenAI model was requested.',
        );
      }

      const openAiTokenParam = prefersMaxCompletionTokens(model)
        ? { max_completion_tokens: params.maxTokens ?? 2048 }
        : { max_tokens: params.maxTokens ?? 2048 };

      const completion = await this.deps.openai.chat.completions.create({
        model,
        messages: params.messages as any,
        temperature: params.temperature,
        ...(openAiTokenParam as any),
        response_format: { type: 'json_object' },
      });

      const raw = String(
        completion.choices?.[0]?.message?.content ?? '',
      ).trim();
      if (!raw) throw new Error('Empty JSON response');
      return JSON.parse(raw) as T;
    }

    if (!this.deps.anthropic) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set, but an Anthropic model was requested.',
      );
    }

    const baseMessages = (params.messages || []).slice();

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const attemptMessages: LlmMessage[] = baseMessages.slice();

      // Strengthen JSON-only instruction on retries.
      if (attempt > 0) {
        attemptMessages.unshift({
          role: 'system',
          content:
            'IMPORTANT: Your previous response was invalid JSON. ' +
            'Return ONLY valid JSON. No prose, no markdown, no code fences.',
        });
      }

      const text = await this.completeText({
        model,
        messages: attemptMessages,
        temperature: params.temperature,
        maxTokens: params.maxTokens ?? 2048,
      });

      const jsonText = tryExtractJson(text);
      try {
        return JSON.parse(jsonText) as T;
      } catch (err) {
        if (attempt >= retries) throw err;
      }
    }

    // Unreachable
    throw new Error('Failed to produce valid JSON');
  }
}
