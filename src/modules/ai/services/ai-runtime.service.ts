import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { LlmRouter } from '../llm/llm-router';

@Injectable()
export class AiRuntimeService {
  public readonly openai: OpenAI | null;
  public readonly anthropic: Anthropic | null;
  public readonly llm: LlmRouter;

  public readonly model: string;
  public readonly cheapModel: string;
  public readonly imageModel: string;

  public readonly geminiApiKey?: string;
  public readonly geminiTtsModel: string;

  public readonly elevenApiKey?: string;
  public readonly elevenDefaultVoiceId: string;
  public readonly googleTtsDefaultVoiceName?: string;

  public readonly leonardoApiKey?: string;
  public readonly leonardoModelId?: string;

  constructor() {
    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    this.geminiApiKey = (geminiKey || '').trim() || undefined;
    this.geminiTtsModel =
      String(process.env.GEMINI_TTS_MODEL ?? '').trim() ||
      'gemini-2.5-flash-preview-tts';

    this.openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;
    this.anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;

    if (!this.openai && !this.anthropic && !(geminiKey || '').trim()) {
      throw new Error(
        'Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY in the environment.',
      );
    }

    this.llm = new LlmRouter({
      openai: this.openai,
      anthropic: this.anthropic,
      geminiApiKey: geminiKey,
    });

    // Default text model is Anthropic-first (as requested). Users can still explicitly
    // select OpenAI models from the UI.
    this.model =
      process.env.DEFAULT_TEXT_MODEL ||
      process.env.ANTHROPIC_DEFAULT_MODEL ||
      'claude-sonnet-4-5';

    // Used for small classification tasks (cheaper/faster than the main model).
    const defaultCheapModel = ((): string => {
      if ((openaiKey ?? '').trim()) return 'gpt-4o-mini';
      if ((anthropicKey ?? '').trim()) return 'claude-3-haiku-20240307';
      if ((geminiKey ?? '').trim()) return 'gemini-1.5-flash';
      return 'gpt-4o-mini';
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

    // AI Studio voices (Gemini TTS)
    this.googleTtsDefaultVoiceName = process.env.GOOGLE_TTS_VOICE_NAME;

    this.leonardoApiKey = process.env.LEONARDO_API_KEY;
    this.leonardoModelId = process.env.LEONARDO_MODEL_ID;
  }
}
