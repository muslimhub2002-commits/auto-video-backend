import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { AiRuntimeService } from './ai-runtime.service';

@Injectable()
export class AiVoiceService {
  constructor(private readonly runtime: AiRuntimeService) {}

  private parseMimeType(raw: string): {
    base: string;
    params: Record<string, string>;
  } {
    const value = String(raw ?? '').trim();
    if (!value) return { base: '', params: {} };

    const [baseRaw, ...rest] = value.split(';');
    const base = String(baseRaw ?? '').trim().toLowerCase();

    const params: Record<string, string> = {};
    for (const seg of rest) {
      const [kRaw, vRaw] = String(seg ?? '').split('=');
      const key = String(kRaw ?? '').trim().toLowerCase();
      const val = String(vRaw ?? '').trim();
      if (key) params[key] = val;
    }

    return { base, params };
  }

  private pcm16leToWav(params: {
    pcm: Buffer;
    sampleRate: number;
    channels: number;
  }): Buffer {
    const sampleRate = Number.isFinite(params.sampleRate) && params.sampleRate > 0 ? params.sampleRate : 24000;
    const channels = Number.isFinite(params.channels) && params.channels > 0 ? params.channels : 1;
    const bitsPerSample = 16;

    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const dataSize = params.pcm.length;
    const riffChunkSize = 36 + dataSize;

    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 4, 'ascii');
    header.writeUInt32LE(riffChunkSize >>> 0, 4);
    header.write('WAVE', 8, 4, 'ascii');
    header.write('fmt ', 12, 4, 'ascii');
    header.writeUInt32LE(16, 16); // PCM fmt chunk size
    header.writeUInt16LE(1, 20); // AudioFormat=1 (PCM)
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate >>> 0, 24);
    header.writeUInt32LE(byteRate >>> 0, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36, 4, 'ascii');
    header.writeUInt32LE(dataSize >>> 0, 40);

    return Buffer.concat([header, params.pcm]);
  }

  private isRunningOnVercel(): boolean {
    // Vercel sets VERCEL=1 on build/runtime.
    return String(process.env.VERCEL ?? '').trim() === '1';
  }

  private looksLikeWav(buffer: Buffer): boolean {
    if (!buffer || buffer.length < 12) return false;
    return (
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WAVE'
    );
  }

  private normalizeMimeType(raw: string): string {
    const value = String(raw ?? '').trim();
    if (!value) return '';
    // Strip parameters: "audio/wav;codec=..." -> "audio/wav"
    return value.split(';')[0]!.trim().toLowerCase();
  }

  private extensionFromMimeType(mimeTypeRaw: string): string {
    const mimeType = this.normalizeMimeType(mimeTypeRaw);
    switch (mimeType) {
      case 'audio/mpeg':
      case 'audio/mp3':
        return 'mp3';
      case 'audio/wav':
      case 'audio/x-wav':
        return 'wav';
      case 'audio/webm':
        return 'webm';
      case 'audio/ogg':
        return 'ogg';
      case 'audio/flac':
        return 'flac';
      case 'audio/aac':
        return 'aac';
      case 'audio/pcm':
      case 'audio/l16':
        return 'pcm';
      default:
        return '';
    }
  }

  private get geminiApiKey() {
    return this.runtime.geminiApiKey;
  }
  private get geminiTtsModel() {
    return this.runtime.geminiTtsModel;
  }
  private get elevenApiKey() {
    return this.runtime.elevenApiKey;
  }
  private get elevenDefaultVoiceId() {
    return this.runtime.elevenDefaultVoiceId;
  }
  private get googleTtsDefaultVoiceName() {
    return this.runtime.googleTtsDefaultVoiceName;
  }

  private mergeSentenceTexts(sentences: string[]): string {
    return (sentences || [])
      .map((s) => (s ?? '').trim())
      .filter(Boolean)
      .map((s) => (/[^ \s][.!?]$/.test(s) ? s : `${s}.`))
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  async generateVoiceForSentences(
    sentences: string[],
    voiceId?: string,
    styleInstructions?: string,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const merged = this.mergeSentenceTexts(sentences);
    return this.generateVoiceForScript(merged, voiceId, styleInstructions);
  }

  async generateVoiceForScript(
    script: string,
    voiceId?: string,
    styleInstructions?: string,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const text = script?.trim();
    if (!text) {
      throw new BadRequestException('Script text is required to generate voice');
    }

    const decideProvider = (
      idRaw?: string,
    ): { provider: 'google' | 'elevenlabs'; rawId?: string } => {
      const id = String(idRaw ?? '').trim();
      if (!id) {
        if ((this.geminiApiKey || '').trim()) {
          return {
            provider: 'google',
            rawId: this.googleTtsDefaultVoiceName?.trim() || undefined,
          };
        }
        return { provider: 'elevenlabs', rawId: this.elevenDefaultVoiceId };
      }

      if (id.startsWith('google:')) {
        return { provider: 'google', rawId: id.slice('google:'.length) };
      }

      if (id.startsWith('elevenlabs:')) {
        return { provider: 'elevenlabs', rawId: id.slice('elevenlabs:'.length) };
      }

      // Backwards compatibility:
      if (/^[a-z]{2}-[A-Z]{2}-/u.test(id)) {
        return { provider: 'google', rawId: id };
      }

      return { provider: 'elevenlabs', rawId: id };
    };

    const chosen = decideProvider(voiceId);
    if (chosen.provider === 'google') {
      const voiceName = String(chosen.rawId ?? '').trim();
      if (!voiceName) {
        throw new BadRequestException('voiceId is required for Google TTS');
      }
      const result = await this.generateVoiceWithGeminiTts({
        text,
        voiceName,
        styleInstructions,
      });
      return result;
    }

    const elevenVoiceId = String(chosen.rawId ?? '').trim() || this.elevenDefaultVoiceId;
    const buffer = await this.generateVoiceWithElevenLabs({
      text,
      voiceId: elevenVoiceId,
    });
    return { buffer, mimeType: 'audio/mpeg', filename: 'voice-over.mp3' };
  }

  private async generateVoiceWithElevenLabs(params: {
    text: string;
    voiceId: string;
  }): Promise<Buffer> {
    if (!this.elevenApiKey) {
      throw new InternalServerErrorException(
        'ELEVENLABS_API_KEY is not configured on the server',
      );
    }

    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${params.voiceId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
            'xi-api-key': this.elevenApiKey,
          },
          body: JSON.stringify({
            text: params.text,
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
      const err: any = error;

      console.error('Error while calling ElevenLabs TTS', {
        message: err?.message,
        stack: err?.stack,
      });
      if (err instanceof BadRequestException || err instanceof UnauthorizedException) {
        throw err;
      }
      throw new InternalServerErrorException(
        'Unexpected error while generating voice with ElevenLabs',
      );
    }
  }

  private looksLikeMp3(buffer: Buffer): boolean {
    if (!buffer || buffer.length < 4) return false;
    if (buffer.toString('ascii', 0, 3) === 'ID3') return true;

    // AAC ADTS can look superficially similar (0xFF 0xF1/0xF9).
    const looksLikeAacAdts =
      buffer[0] === 0xff &&
      (buffer[1] & 0xf0) === 0xf0 &&
      (buffer[1] & 0x06) === 0x00;
    if (looksLikeAacAdts) return false;

    if (!(buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return false;

    const versionId = (buffer[1] >> 3) & 0x3;
    const layer = (buffer[1] >> 1) & 0x3;
    if (versionId === 0x1) return false;
    if (layer === 0x0) return false;

    return true;
  }

  private async generateVoiceWithGeminiTts(params: {
    text: string;
    voiceName: string;
    styleInstructions?: string;
  }): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    if (!this.geminiApiKey) {
      throw new InternalServerErrorException(
        'GEMINI_API_KEY is not configured on the server',
      );
    }

    // Note: we do not transcode server-side (ffmpeg removed). We return whichever
    // supported container Gemini provides (MP3 or WAV).
    if (this.isRunningOnVercel()) {
      // Just a guardrail: Vercel is fine, but WAV payloads can be larger.
      // No behavioral change needed.
    }

    try {
      const url = new URL(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          this.geminiTtsModel,
        )}:generateContent`,
      );
      url.searchParams.set('key', this.geminiApiKey);

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: (() => {
                    const style = String(params.styleInstructions ?? '').trim();
                    if (!style) return params.text;

                    return (
                      `Style instructions (do NOT speak these instructions): ${style}\n\n` +
                      `Read the following script exactly as written:\n${params.text}`
                    );
                  })(),
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: params.voiceName,
                },
              },
            },
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error('Gemini TTS failed', {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
        });

        if (response.status === 400) {
          throw new BadRequestException('Invalid request to Gemini TTS API');
        }

        if (response.status === 401 || response.status === 403) {
          throw new UnauthorizedException('Unauthorized to call Gemini TTS API');
        }

        throw new InternalServerErrorException(
          'Failed to generate voice using Gemini TTS',
        );
      }

      const json = await response.json();
      const parts =
        json?.candidates?.[0]?.content?.parts &&
        Array.isArray(json.candidates[0].content.parts)
          ? json.candidates[0].content.parts
          : [];

      const audioPart = parts.find((p: any) =>
        Boolean(p?.inlineData?.data || p?.inline_data?.data),
      );
      const b64 = String(
        audioPart?.inlineData?.data ?? audioPart?.inline_data?.data ?? '',
      ).trim();

      const declaredMimeType = this.normalizeMimeType(
        String(
          audioPart?.inlineData?.mimeType ??
            audioPart?.inlineData?.mime_type ??
            audioPart?.inline_data?.mimeType ??
            audioPart?.inline_data?.mime_type ??
            '',
        ),
      );

      const declaredMimeTypeFull = String(
        audioPart?.inlineData?.mimeType ??
          audioPart?.inlineData?.mime_type ??
          audioPart?.inline_data?.mimeType ??
          audioPart?.inline_data?.mime_type ??
          '',
      ).trim();

      if (!b64) {
        throw new InternalServerErrorException(
          'Gemini TTS returned empty audio data',
        );
      }

      const audioBytes = Buffer.from(b64, 'base64');

      // If Gemini returns raw PCM (e.g. audio/L16 or audio/pcm), wrap it in a WAV
      // container so browsers can play it and report duration (no transcoding).
      if (declaredMimeTypeFull) {
        const parsed = this.parseMimeType(declaredMimeTypeFull);
        if (parsed.base === 'audio/pcm' || parsed.base === 'audio/l16') {
          const rateRaw = parsed.params['rate'] ?? parsed.params['samplerate'] ?? parsed.params['sample_rate'];
          const channelsRaw = parsed.params['channels'] ?? parsed.params['channel'];
          const sampleRate = Number.parseInt(String(rateRaw ?? ''), 10);
          const channels = Number.parseInt(String(channelsRaw ?? ''), 10);

          const wav = this.pcm16leToWav({
            pcm: audioBytes,
            sampleRate: Number.isFinite(sampleRate) ? sampleRate : 24000,
            channels: Number.isFinite(channels) ? channels : 1,
          });
          return { buffer: wav, mimeType: 'audio/wav', filename: 'voice-over.wav' };
        }
      }

      // Prefer Gemini's declared mimeType if it provides one.
      if (declaredMimeType) {
        const ext = this.extensionFromMimeType(declaredMimeType);
        const filename = ext ? `voice-over.${ext}` : 'voice-over.bin';
        return {
          buffer: audioBytes,
          mimeType: declaredMimeType,
          filename,
        };
      }

      if (this.looksLikeMp3(audioBytes)) {
        return { buffer: audioBytes, mimeType: 'audio/mpeg', filename: 'voice-over.mp3' };
      }

      if (this.looksLikeWav(audioBytes)) {
        return { buffer: audioBytes, mimeType: 'audio/wav', filename: 'voice-over.wav' };
      }

      // Return the raw bytes even if we can't identify the container.
      // Clients (and OpenAI transcription) can often handle the payload.
      return {
        buffer: audioBytes,
        mimeType: 'application/octet-stream',
        filename: 'voice-over.bin',
      };
    } catch (error) {
      const err: any = error;

      console.error('Error while calling Gemini TTS', {
        message: err?.message,
        stack: err?.stack,
      });

      if (err instanceof BadRequestException || err instanceof UnauthorizedException) {
        throw err;
      }

      throw new InternalServerErrorException(
        'Unexpected error while generating voice with Gemini TTS',
      );
    }
  }
}
