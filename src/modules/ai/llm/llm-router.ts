import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { LlmCompleteJsonParams, LlmCompleteParams, LlmMessage, LlmStreamParams } from './llm-types';

const isAnthropicModel = (model: string) => /^claude-/i.test(model || '');

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
  constructor(
    private readonly deps: {
      openai: OpenAI | null;
      anthropic: Anthropic | null;
    },
  ) {}

  async *streamText(params: LlmStreamParams): AsyncIterable<string> {
    const model = String(params.model || '').trim();
    const maxTokens = Number.isFinite(params.maxTokens) ? Number(params.maxTokens) : 2048;

    if (isAnthropicModel(model)) {
      if (!this.deps.anthropic) {
        throw new Error('ANTHROPIC_API_KEY is not set, but an Anthropic model was requested.');
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
        if (event?.type === 'content_block_delta' && event?.delta?.type === 'text_delta') {
          const text = String(event.delta.text ?? '');
          if (text) yield text;
        }
      }

      return;
    }

    if (!this.deps.openai) {
      throw new Error('OPENAI_API_KEY is not set, but an OpenAI model was requested.');
    }

    const stream = await this.deps.openai.chat.completions.create({
      model,
      stream: true,
      messages: params.messages as any,
      temperature: params.temperature,
      max_tokens: maxTokens,
    });

    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content ?? '';
      if (content) yield content;
    }
  }

  async completeText(params: LlmCompleteParams): Promise<string> {
    const model = String(params.model || '').trim();
    const maxTokens = Number.isFinite(params.maxTokens) ? Number(params.maxTokens) : 2048;

    if (isAnthropicModel(model)) {
      if (!this.deps.anthropic) {
        throw new Error('ANTHROPIC_API_KEY is not set, but an Anthropic model was requested.');
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
      throw new Error('OPENAI_API_KEY is not set, but an OpenAI model was requested.');
    }

    const completion = await this.deps.openai.chat.completions.create({
      model,
      messages: params.messages as any,
      temperature: params.temperature,
      max_tokens: maxTokens,
    });

    return String(completion.choices?.[0]?.message?.content ?? '');
  }

  async completeJson<T = any>(params: LlmCompleteJsonParams): Promise<T> {
    const retries = Number.isFinite(params.retries) ? Number(params.retries) : 2;

    // For OpenAI we can use strict JSON mode; for Anthropic, enforce via prompt + parse.
    const model = String(params.model || '').trim();

    if (!isAnthropicModel(model)) {
      if (!this.deps.openai) {
        throw new Error('OPENAI_API_KEY is not set, but an OpenAI model was requested.');
      }

      const completion = await this.deps.openai.chat.completions.create({
        model,
        messages: params.messages as any,
        temperature: params.temperature,
        max_tokens: params.maxTokens ?? 2048,
        response_format: { type: 'json_object' },
      });

      const raw = String(completion.choices?.[0]?.message?.content ?? '').trim();
      if (!raw) throw new Error('Empty JSON response');
      return JSON.parse(raw) as T;
    }

    if (!this.deps.anthropic) {
      throw new Error('ANTHROPIC_API_KEY is not set, but an Anthropic model was requested.');
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
