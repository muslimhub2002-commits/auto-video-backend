import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { LlmRouter } from '../llm/llm-router';

@Injectable()
export class AiRuntimeService {
  public readonly openai: OpenAI | null;
  public readonly deepseek: OpenAI | null;
  public readonly grok: OpenAI | null;
  public readonly nvidia: OpenAI | null;
  // OpenAI-compatible client for Google's v1beta/openai endpoint
  // Reserved for Gemini models that require the OpenAI-compat path.
  public readonly geminiCompat: OpenAI | null;
  public readonly anthropic: Anthropic | null;
  public readonly llm: LlmRouter;

  public readonly model: string;
  public readonly cheapModel: string;
  public readonly imageModel: string;

  public readonly geminiApiKey?: string;
  public readonly geminiTtsModel: string;

  public readonly grokApiKey?: string;
  public readonly klingApiKey?: string;
  public readonly klingSecretKey?: string;
  public readonly nvidiaApiKey?: string;

  public readonly elevenApiKey?: string;
  public readonly elevenDefaultVoiceId: string;
  public readonly googleTtsDefaultVoiceName?: string;

  public readonly minimaxApiKey?: string;
  public readonly minimaxDefaultVoiceId?: string;
  public readonly minimaxTtsModel: string;

  public readonly leonardoApiKey?: string;
  public readonly leonardoModelId?: string;

  constructor() {
    const openaiKey = process.env.OPENAI_API_KEY;
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    const grokKey = process.env.GROK_API_KEY;
    const klingKey = process.env.KLING_API_KEY;
    const klingSecretKey = process.env.KLING_SECRET_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    const nvidiaKey = process.env.NVIDIA_API_KEY;

    this.geminiApiKey = (geminiKey || '').trim() || undefined;
    this.geminiTtsModel =
      String(process.env.GEMINI_TTS_MODEL ?? '').trim() ||
      'gemini-2.5-flash-preview-tts';

    this.grokApiKey = (grokKey || '').trim() || undefined;
    this.klingApiKey = (klingKey || '').trim() || undefined;
    this.klingSecretKey = (klingSecretKey || '').trim() || undefined;
    this.nvidiaApiKey = (nvidiaKey || '').trim() || undefined;

    this.openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;
    this.deepseek = deepseekKey
      ? new OpenAI({
        apiKey: deepseekKey,
        baseURL: 'https://api.deepseek.com/v1',
      })
      : null;
    this.grok = grokKey
      ? new OpenAI({ apiKey: grokKey, baseURL: 'https://api.x.ai/v1' })
      : null;
    this.nvidia = nvidiaKey
      ? new OpenAI({
        apiKey: nvidiaKey,
        baseURL: 'https://integrate.api.nvidia.com/v1',
      })
      : null;
    // OpenAI-compatible client for Google's v1beta/openai endpoint.
    // May be used for specific Gemini models that require the OpenAI-compat path.
    this.geminiCompat = (geminiKey || '').trim()
      ? new OpenAI({
        apiKey: geminiKey!,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      })
      : null;
    this.anthropic = anthropicKey
      ? new Anthropic({ apiKey: anthropicKey })
      : null;

    if (
      !this.openai &&
      !this.deepseek &&
      !this.grok &&
      !(klingKey || '').trim() &&
      !this.anthropic &&
      !(geminiKey || '').trim() &&
      !this.nvidia
    ) {
      throw new Error(
        'Set OPENAI_API_KEY, DEEPSEEK_API_KEY, GROK_API_KEY, KLING_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, or NVIDIA_API_KEY in the environment.',
      );
    }

    this.llm = new LlmRouter({
      openai: this.openai,
      deepseek: this.deepseek,
      grok: this.grok,
      anthropic: this.anthropic,
      geminiApiKey: geminiKey,
      nvidia: this.nvidia,
      geminiCompat: this.geminiCompat,
    });

    // Default text model is Anthropic-first when available. Otherwise, fall back to
    // another configured provider so the runtime does not point at an unavailable model.
    const defaultMainModel = ((): string => {
      if ((anthropicKey ?? '').trim()) return 'claude-sonnet-4-5';
      if ((openaiKey ?? '').trim()) {
        return String(process.env.OPENAI_MODEL ?? '').trim() || 'gpt-4o-mini';
      }
      if ((deepseekKey ?? '').trim()) return 'deepseek-chat';
      if ((grokKey ?? '').trim()) return 'grok-4';
      if ((geminiKey ?? '').trim()) return 'gemini-2.0-flash';
      return 'claude-sonnet-4-5';
    })();

    this.model =
      process.env.DEFAULT_TEXT_MODEL ||
      process.env.ANTHROPIC_DEFAULT_MODEL ||
      defaultMainModel;

    // Used for small classification tasks (cheaper/faster than the main model).
    // gemini-3.5-flash is the preferred cheap model when GEMINI_API_KEY is available
    // (free tier via generativelanguage.googleapis.com/v1beta — native SDK path).
    const defaultCheapModel = ((): string => {
      if ((geminiKey ?? '').trim()) return 'gemini-3.5-flash';
      if ((openaiKey ?? '').trim()) return 'gpt-4.1-mini';
      if ((deepseekKey ?? '').trim()) return 'deepseek-chat';
      if ((grokKey ?? '').trim()) return 'grok-3-mini-latest';
      if ((anthropicKey ?? '').trim()) return 'claude-3-haiku-20240307';
      if ((nvidiaKey ?? '').trim()) return 'minimaxai/minimax-m3';
      return 'gpt-4.1-mini';
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

    // MiniMax TTS
    this.minimaxApiKey =
      (process.env.MINIMAX_API_KEY || '').trim() || undefined;
    this.minimaxDefaultVoiceId =
      process.env.MINIMAX_DEFAULT_VOICE_ID?.trim() || undefined;
    this.minimaxTtsModel =
      String(process.env.MINIMAX_TTS_MODEL ?? '').trim() || 'speech-2.8-hd';

    // AI Studio voices (Gemini TTS)
    this.googleTtsDefaultVoiceName = process.env.GOOGLE_TTS_VOICE_NAME;

    this.leonardoApiKey = process.env.LEONARDO_API_KEY;
    this.leonardoModelId = process.env.LEONARDO_MODEL_ID;
  }
}
