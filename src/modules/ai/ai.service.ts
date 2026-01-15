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
import { ImagesService } from '../images/images.service';
import { ImageQuality, ImageSize } from '../images/entities/image.entity';

@Injectable()
export class AiService {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly imageModel: string;
  private readonly elevenApiKey?: string;
  private readonly elevenDefaultVoiceId: string;
  private readonly leonardoApiKey?: string;
  private readonly leonardoModelId?: string;

  // Narration pacing assumption (words per minute) used to derive strict word-count targets.
  private readonly narrationWpm = 150;

  constructor(private readonly imagesService: ImagesService) {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      // Fail fast if the key is missing so it's obvious in dev
      throw new Error('OPENAI_API_KEY is not set in the environment.');
    }

    this.client = new OpenAI({ apiKey });
    this.model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
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

  /**
   * Returns an async iterable stream of script content chunks from OpenAI.
   */
  async createScriptStream(options: GenerateScriptDto) {
    const subject = options.subject?.trim() || 'religious (Islam)';
    const subjectContent = options.subjectContent?.trim();
    const length = options.length?.trim() || '1 minute';
    const style = options.style?.trim() || 'Conversational';
    const model = options.model?.trim() || this.model;
    const wordRange = this.getStrictWordRange(length);

    try {
      const stream = await this.client.chat.completions.create({
        model,
        stream: true,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert video script writer. ' +
              'You ONLY respond with the script text, no explanations, headings, or markdown. ' +
              'Write clear, engaging narration suitable for AI video generation. ' +
              'Prioritize: (1) Perfect Hook for Customer Attention, (2) Curiosity / Open Loops, (3) Story Arc / Micro Narrative, (4) Rhythm & Pacing, (5) Emotional Trigger. ' +
              `HARD LENGTH CONSTRAINT: Output MUST be between ${wordRange.minWords} and ${wordRange.maxWords} words (target ${wordRange.targetWords}). Count words before responding; if over or under, rewrite until within range.`,
          },
          {
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
                `1) Curiosity / Open Loops: introduce an unanswered question early and pay it off later.\n` +
                `2) Story Arc / Micro Narrative: a clear setup → tension/problem → insight/turn → resolution.\n` +
                `3) Rhythm & Pacing: short punchy lines mixed with a few longer lines; avoid monotone cadence.\n` +
                `4) Emotional Trigger: open with a strong feeling (awe, hope, urgency, empathy, etc.).\n` +
              `For religious (Islam) scripts, keep it respectful, authentic, and avoid controversial topics.\n` +
              `Do not include scene directions, only spoken narration.`,
          },
        ],
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
  }): Promise<string[]> {
    try {
      const script = dto.script;
      const model = dto.model?.trim() || this.model;
      const completion = await this.client.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You split long scripts into clean sentences. ' +
              'You cannot write any more or less words than the original script. ' +
              'Ensure each sentence is self-contained and suitable for pairing with a single image. ' +
              'Sentences cannot be too short, it can be long if there is a deep meaning to the sentence. ' +
              'Always respond with pure JSON: an array of strings. No extra text.',
          },
          {
            role: 'user',
            content:
              'Split the following script into a list of sentences suitable for individual images. ' +
              'Return ONLY a JSON array of strings, each string being one sentence:\n\n' +
              script,
          },
        ],
        response_format: { type: 'json_object' },
      });

      const raw = completion.choices[0]?.message?.content;
      if (!raw) {
        throw new Error('Empty response from OpenAI');
      }

      // Expecting something like: { "sentences": ["...", "..."] }
      const parsed = JSON.parse(raw) as { sentences?: string[] };
      if (!parsed.sentences || !Array.isArray(parsed.sentences)) {
        throw new Error('Invalid JSON structure for sentences');
      }

      return parsed.sentences.map((s) => s.trim()).filter(Boolean);
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
    const model = dto.model?.trim() || this.model;
    const wordRange = this.getStrictWordRange(length);
    
    try {
      const stream = await this.client.chat.completions.create({
        model,
        stream: true,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert video script editor. ' +
              'You improve existing narration scripts by enhancing clarity, flow, and emotional impact, ' +
              'while strictly preserving the original meaning, topic, and approximate length. ' +
              'You ONLY respond with the improved script text, no explanations, headings, or markdown. ' +
              `HARD LENGTH CONSTRAINT: Your output MUST be between ${wordRange.minWords} and ${wordRange.maxWords} words (target ${wordRange.targetWords}). Count words before responding; if over or under, rewrite until within range.`,
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
            'Rules: title <= 100 chars, description <= 5000 chars, tags: 10-20 items, each tag <= 30 chars, no hashtags, no emojis.',
        },
        {
          role: 'user',
          content:
            'Generate YouTube SEO metadata for this video script. ' +
            'The title should be compelling and keyword-rich. ' +
            'The description should include a strong first 2 lines, a short summary, and relevant keywords naturally. ' +
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
    const description = String(parsed.description ?? '').trim().slice(0, 5000);
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags
          .map((t: any) => String(t).trim())
          .filter(Boolean)
          .map((t: string) => t.replace(/^#/, ''))
          .map((t: string) => t.slice(0, 30))
          .slice(0, 25)
      : [];

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

    try {
      // First ask the chat model for a detailed image prompt
      const promptCompletion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              'You are a visual prompt engineer for image generation models. ' +
              'Given a narration sentence, you create one detailed, vivid image prompt. ' +
              'Make the visual gradient, catchy, composition rich, varied, and imaginative with various comforting colors. ' +
              'The scene must not contain any written words, letters, symbols, or text overlays. ' +
              'Do NOT mention camera settings unless clearly helpful. ' +
              'Respond with a single prompt sentence only, describing visuals only.',
          },
          {
            role: 'user',
            content:
              `Sentence: "${dto.sentence}"\n` +
              `Desired style: ${style} (anime-style artwork).\n\n` +
              // Safety / theological constraints for religious content
              'Important constraints:\n' +
              '- The image must not contain any females at all.\n' +
              '- If the content is religious, especially Islamic, do NOT depict God, any divine being, any prophet, or any of the Sahaba/Companions.\n' +
              '- Prefer abstract, calligraphic, architectural, landscape, or symbolic representations instead of people for such cases.\n' +
              '- Be creative with scenery, nature, architecture, and symbolic elements to convey the message without human figures.\n' +
              '- The overall look should be consistent with anime-style illustration.\n' +
              '- Absolutely no visible text, captions, calligraphy phrases, logos, or any readable characters in the scene. Focus purely on graphical and environmental elements.\n\n' +
              'Return only the final image prompt text, with these constraints already applied, and do not include any quotation marks.',
          },
        ],
      });

      const prompt =
        promptCompletion.choices[0]?.message?.content?.trim() || dto.sentence;

      // Decide target aspect ratio / dimensions based on script length.
      // For short scripts (e.g. 30 seconds or 1 minute), prefer a
      // vertical format suitable for reels/shorts. Otherwise use
      // a landscape 16:9.
      const rawLength = dto.scriptLength?.toLowerCase() ?? '';
      const isShortForm =
        rawLength.includes('30 second') || rawLength.includes('1 minute');

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
