import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import * as ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { AiRuntimeService } from './ai-runtime.service';

@Injectable()
export class AiVoiceService {
  constructor(private readonly runtime: AiRuntimeService) {}

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
      const buffer = await this.generateVoiceWithGeminiTts({
        text,
        voiceName,
        styleInstructions,
      });
      return { buffer, mimeType: 'audio/mpeg', filename: 'voice-over.mp3' };
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

  private async pcm16leToMp3Async(params: {
    pcm: Buffer;
    sampleRate: number;
    channels: 1 | 2;
    kbps?: number;
  }): Promise<Buffer> {
    const { pcm, sampleRate, channels, kbps = 128 } = params;

    const installerPath = ffmpegInstaller?.path ?? (ffmpegInstaller as any)?.default?.path;
    const candidatePath =
      String(installerPath ?? '').trim() ||
      String(ffmpegPath ?? '').trim() ||
      String(process.env.FFMPEG_PATH ?? '').trim() ||
      'ffmpeg';

    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      's16le',
      '-ar',
      String(sampleRate),
      '-ac',
      String(channels),
      '-i',
      'pipe:0',
      '-vn',
      '-acodec',
      'libmp3lame',
      '-b:a',
      `${kbps}k`,
      '-f',
      'mp3',
      'pipe:1',
    ];

    const child = spawn(candidatePath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (d) => stdoutChunks.push(Buffer.from(d)));
    child.stderr.on('data', (d) => stderrChunks.push(Buffer.from(d)));

    child.stdin.end(pcm);

    const exitCode: number = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });

    const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
    if (exitCode !== 0) {
      throw new InternalServerErrorException(
        `ffmpeg failed to encode MP3 (exit ${exitCode})${stderr ? `: ${stderr}` : ''}`,
      );
    }

    const out = Buffer.concat(stdoutChunks);
    if (!out.length) {
      throw new InternalServerErrorException(
        `ffmpeg returned empty MP3 output${stderr ? `: ${stderr}` : ''}`,
      );
    }
    return out;
  }

  private looksLikeWav(buffer: Buffer): boolean {
    if (!buffer || buffer.length < 12) return false;
    return (
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WAVE'
    );
  }

  private looksLikeMp3(buffer: Buffer): boolean {
    if (!buffer || buffer.length < 3) return false;
    if (buffer.toString('ascii', 0, 3) === 'ID3') return true;
    return buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
  }

  private async wavToMp3Async(params: { wav: Buffer; kbps?: number }): Promise<Buffer> {
    const { wav, kbps = 128 } = params;

    const installerPath = ffmpegInstaller?.path ?? (ffmpegInstaller as any)?.default?.path;
    const candidatePath =
      String(installerPath ?? '').trim() ||
      String(ffmpegPath ?? '').trim() ||
      String(process.env.FFMPEG_PATH ?? '').trim() ||
      'ffmpeg';

    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-vn',
      '-acodec',
      'libmp3lame',
      '-b:a',
      `${kbps}k`,
      '-f',
      'mp3',
      'pipe:1',
    ];

    const child = spawn(candidatePath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (d) => stdoutChunks.push(Buffer.from(d)));
    child.stderr.on('data', (d) => stderrChunks.push(Buffer.from(d)));
    child.stdin.end(wav);

    const exitCode: number = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });

    const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
    if (exitCode !== 0) {
      throw new InternalServerErrorException(
        `ffmpeg failed to transcode WAV to MP3 (exit ${exitCode})${stderr ? `: ${stderr}` : ''}`,
      );
    }

    const out = Buffer.concat(stdoutChunks);
    if (!out.length) {
      throw new InternalServerErrorException(
        `ffmpeg returned empty MP3 output${stderr ? `: ${stderr}` : ''}`,
      );
    }
    return out;
  }

  private async generateVoiceWithGeminiTts(params: {
    text: string;
    voiceName: string;
    styleInstructions?: string;
  }): Promise<Buffer> {
    if (!this.geminiApiKey) {
      throw new InternalServerErrorException(
        'GEMINI_API_KEY is not configured on the server',
      );
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

      if (!b64) {
        throw new InternalServerErrorException(
          'Gemini TTS returned empty audio data',
        );
      }

      const audioBytes = Buffer.from(b64, 'base64');

      if (this.looksLikeMp3(audioBytes)) {
        return audioBytes;
      }

      if (this.looksLikeWav(audioBytes)) {
        return await this.wavToMp3Async({ wav: audioBytes, kbps: 128 });
      }

      return await this.pcm16leToMp3Async({
        pcm: audioBytes,
        sampleRate: 24000,
        channels: 1,
        kbps: 128,
      });
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
