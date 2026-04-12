import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { AiRuntimeService } from './ai-runtime.service';
import { withTimeout } from '../../render-videos/utils/promise.utils';

type VoiceProvider = 'google' | 'elevenlabs';

type ElevenLabsVoiceSettings = {
  stability?: number;
  similarityBoost?: number;
  style?: number;
  speed?: number;
  useSpeakerBoost?: boolean;
};

type ElevenLabsVoiceSettingsPayload = {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  speed?: number;
  use_speaker_boost?: boolean;
};

const ELEVENLABS_DEFAULT_VOICE_SETTINGS = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  speed: 1,
  useSpeakerBoost: true,
} as const;

@Injectable()
export class AiVoiceService {
  private readonly narrationWpm = 150;

  constructor(private readonly runtime: AiRuntimeService) {}

  private estimateScriptSeconds(value: string): number {
    const wordCount = String(value ?? '')
      .trim()
      .split(/\s+/u)
      .filter(Boolean).length;
    return Math.max(1, Math.round((wordCount * 60) / this.narrationWpm));
  }

  private getProviderTimeoutMs(provider: VoiceProvider): number {
    const raw =
      provider === 'google'
        ? process.env.GEMINI_TTS_TIMEOUT_MS
        : process.env.ELEVENLABS_TTS_TIMEOUT_MS;
    const fallback = provider === 'google' ? 240_000 : 180_000;
    const value = Number(raw ?? fallback);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private getMergeTimeoutMs(): number {
    const value = Number(process.env.AI_VOICE_MERGE_TIMEOUT_MS ?? 120_000);
    return Number.isFinite(value) && value > 0 ? value : 120_000;
  }

  private isTimeoutError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return /timed out after/i.test(error.message);
  }

  private clampNumber(
    value: unknown,
    min: number,
    max: number,
  ): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.min(max, Math.max(min, parsed));
  }

  private extractApiErrorMessage(raw: string): string | null {
    const fallback = String(raw ?? '').trim();
    if (!fallback) return null;

    const pickFirstString = (value: unknown): string | null => {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }

      if (Array.isArray(value)) {
        for (const entry of value) {
          const found = pickFirstString(entry);
          if (found) return found;
        }
        return null;
      }

      if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        for (const key of ['message', 'detail', 'error', 'body']) {
          const found = pickFirstString(record[key]);
          if (found) return found;
        }
      }

      return null;
    };

    try {
      const parsed = JSON.parse(fallback) as unknown;
      return pickFirstString(parsed) ?? fallback;
    } catch {
      return fallback;
    }
  }

  private buildElevenLabsVoiceSettingsPayload(
    settings?: ElevenLabsVoiceSettings,
    omitKeys: Array<keyof ElevenLabsVoiceSettings> = [],
  ): ElevenLabsVoiceSettingsPayload | undefined {
    if (!settings) return undefined;

    const omitted = new Set<keyof ElevenLabsVoiceSettings>(omitKeys);
    const payload: ElevenLabsVoiceSettingsPayload = {};

    const stability = this.clampNumber(settings.stability, 0, 1);
    if (
      stability !== null &&
      !omitted.has('stability') &&
      Math.abs(stability - ELEVENLABS_DEFAULT_VOICE_SETTINGS.stability) >
        0.0001
    ) {
      payload.stability = stability;
    }

    const similarityBoost = this.clampNumber(settings.similarityBoost, 0, 1);
    if (
      similarityBoost !== null &&
      !omitted.has('similarityBoost') &&
      Math.abs(
        similarityBoost - ELEVENLABS_DEFAULT_VOICE_SETTINGS.similarityBoost,
      ) > 0.0001
    ) {
      payload.similarity_boost = similarityBoost;
    }

    const style = this.clampNumber(settings.style, 0, 1);
    if (
      style !== null &&
      !omitted.has('style') &&
      Math.abs(style - ELEVENLABS_DEFAULT_VOICE_SETTINGS.style) > 0.0001
    ) {
      payload.style = style;
    }

    const speed = this.clampNumber(settings.speed, 0.5, 1.5);
    if (
      speed !== null &&
      !omitted.has('speed') &&
      Math.abs(speed - ELEVENLABS_DEFAULT_VOICE_SETTINGS.speed) > 0.0001
    ) {
      payload.speed = speed;
    }

    if (
      typeof settings.useSpeakerBoost === 'boolean' &&
      !omitted.has('useSpeakerBoost') &&
      settings.useSpeakerBoost !==
        ELEVENLABS_DEFAULT_VOICE_SETTINGS.useSpeakerBoost
    ) {
      payload.use_speaker_boost = settings.useSpeakerBoost;
    }

    return Object.keys(payload).length > 0 ? payload : undefined;
  }

  private async runWithAbortableTimeout<T>(params: {
    label: string;
    timeoutMs: number;
    run: (signal: AbortSignal) => Promise<T>;
  }): Promise<T> {
    const controller = new AbortController();
    try {
      return await withTimeout(
        params.run(controller.signal),
        params.timeoutMs,
        params.label,
      );
    } catch (error) {
      controller.abort();
      throw error;
    }
  }

  private parseMimeType(raw: string): {
    base: string;
    params: Record<string, string>;
  } {
    const value = String(raw ?? '').trim();
    if (!value) return { base: '', params: {} };

    const [baseRaw, ...rest] = value.split(';');
    const base = String(baseRaw ?? '')
      .trim()
      .toLowerCase();

    const params: Record<string, string> = {};
    for (const seg of rest) {
      const [kRaw, vRaw] = String(seg ?? '').split('=');
      const key = String(kRaw ?? '')
        .trim()
        .toLowerCase();
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
    const sampleRate =
      Number.isFinite(params.sampleRate) && params.sampleRate > 0
        ? params.sampleRate
        : 24000;
    const channels =
      Number.isFinite(params.channels) && params.channels > 0
        ? params.channels
        : 1;
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
    return value.split(';')[0].trim().toLowerCase();
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

  private inferExtFromFilename(filenameRaw?: string | null): string {
    const ext = path.extname(String(filenameRaw ?? '').trim()).toLowerCase();
    switch (ext) {
      case '.mp3':
      case '.wav':
      case '.ogg':
      case '.webm':
      case '.flac':
      case '.aac':
      case '.m4a':
        return ext;
      default:
        return '';
    }
  }

  private async callFfmpeg(args: string[]): Promise<void> {
    const renderer: any = await import('@remotion/renderer');
    const task = renderer?.RenderInternals?.callFf?.({
      bin: 'ffmpeg',
      indent: false,
      logLevel: 'warn',
      binariesDirectory: null,
      cancelSignal: undefined,
      args,
    });

    if (!task || typeof task.then !== 'function') {
      throw new Error('Remotion ffmpeg helper not available');
    }

    await task;
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
    elevenLabsSettings?: ElevenLabsVoiceSettings,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const merged = this.mergeSentenceTexts(sentences);
    return this.generateVoiceForScript(
      merged,
      voiceId,
      styleInstructions,
      elevenLabsSettings,
    );
  }

  async generateVoiceForScript(
    script: string,
    voiceId?: string,
    styleInstructions?: string,
    elevenLabsSettings?: ElevenLabsVoiceSettings,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const text = script?.trim();
    if (!text) {
      throw new BadRequestException(
        'Script text is required to generate voice',
      );
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
        return {
          provider: 'elevenlabs',
          rawId: id.slice('elevenlabs:'.length),
        };
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

    const elevenVoiceId =
      String(chosen.rawId ?? '').trim() || this.elevenDefaultVoiceId;
    const buffer = await this.generateVoiceWithElevenLabs({
      text,
      voiceId: elevenVoiceId,
      settings: elevenLabsSettings,
    });
    return { buffer, mimeType: 'audio/mpeg', filename: 'voice-over.mp3' };
  }

  async mergeVoiceAudioChunks(params: {
    chunks: Array<{
      buffer: Buffer;
      mimeType?: string | null;
      filename?: string | null;
    }>;
    outputFormat?: 'mp3' | 'wav';
  }): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const chunks = Array.isArray(params.chunks) ? params.chunks : [];
    if (chunks.length === 0) {
      throw new BadRequestException('No audio chunks were provided for merge');
    }

    if (chunks.length === 1) {
      const only = chunks[0];
      const mimeType = this.normalizeMimeType(String(only.mimeType ?? '')) || 'audio/mpeg';
      const ext = this.extensionFromMimeType(mimeType) || 'mp3';
      return {
        buffer: only.buffer,
        mimeType,
        filename: `voice-over.${ext}`,
      };
    }

    const tmpDir = path.join(os.tmpdir(), `auto-video-voice-merge-${randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      const inputPaths = chunks.map((chunk, index) => {
        const mimeExt = this.extensionFromMimeType(String(chunk.mimeType ?? ''));
        const nameExt = this.inferExtFromFilename(chunk.filename);
        const ext = mimeExt || nameExt.replace(/^\./u, '') || 'mp3';
        const filePath = path.join(
          tmpDir,
          `chunk-${String(index + 1).padStart(2, '0')}.${ext}`,
        );
        fs.writeFileSync(filePath, chunk.buffer);
        return filePath;
      });

      const filterParts: string[] = [];
      const labels: string[] = [];
      for (let index = 0; index < inputPaths.length; index += 1) {
        const label = `a${index}`;
        filterParts.push(
          `[${index}:a]aresample=44100,aformat=sample_fmts=s16:channel_layouts=stereo,asetpts=PTS-STARTPTS[${label}]`,
        );
        labels.push(`[${label}]`);
      }

      filterParts.push(
        `${labels.join('')}concat=n=${inputPaths.length}:v=0:a=1[outa]`,
      );

      const preferWav = params.outputFormat === 'wav';
      const outMp3 = path.join(tmpDir, 'merged.mp3');
      const outWav = path.join(tmpDir, 'merged.wav');
      const baseArgs = [
        '-y',
        ...inputPaths.flatMap((inputPath) => ['-i', inputPath]),
        '-filter_complex',
        filterParts.join(';'),
        '-map',
        '[outa]',
        '-vn',
        '-ar',
        '44100',
        '-ac',
        '2',
      ];

      if (preferWav) {
        await withTimeout(
          this.callFfmpeg([...baseArgs, '-c:a', 'pcm_s16le', outWav]),
          this.getMergeTimeoutMs(),
          'Voice chunk merge',
        );
      } else {
        try {
          await withTimeout(
            this.callFfmpeg([
              ...baseArgs,
              '-c:a',
              'libmp3lame',
              '-q:a',
              '4',
              outMp3,
            ]),
            this.getMergeTimeoutMs(),
            'Voice chunk merge',
          );
        } catch {
          await withTimeout(
            this.callFfmpeg([...baseArgs, '-c:a', 'pcm_s16le', outWav]),
            this.getMergeTimeoutMs(),
            'Voice chunk merge fallback',
          );
        }
      }

      const outputPath = fs.existsSync(outMp3) ? outMp3 : outWav;
      const buffer = fs.readFileSync(outputPath);
      const isWav = outputPath.toLowerCase().endsWith('.wav');
      return {
        buffer,
        mimeType: isWav ? 'audio/wav' : 'audio/mpeg',
        filename: isWav ? 'voice-over-merged.wav' : 'voice-over-merged.mp3',
      };
    } catch (error) {
      if (this.isTimeoutError(error)) {
        throw new InternalServerErrorException('Voice chunk merge timed out');
      }
      throw new InternalServerErrorException('Failed to merge generated voice chunks');
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }

  private async generateVoiceWithElevenLabs(params: {
    text: string;
    voiceId: string;
    settings?: ElevenLabsVoiceSettings;
  }): Promise<Buffer> {
    if (!this.elevenApiKey) {
      throw new InternalServerErrorException(
        'ELEVENLABS_API_KEY is not configured on the server',
      );
    }

    try {
      const timeoutMs = this.getProviderTimeoutMs('elevenlabs');
      const requestSpeech = async (
        omitKeys: Array<keyof ElevenLabsVoiceSettings> = [],
      ): Promise<
        | { ok: true; buffer: Buffer }
        | {
            ok: false;
            status: number;
            statusText: string;
            errorText: string;
            omittedKeys: Array<keyof ElevenLabsVoiceSettings>;
            payload?: ElevenLabsVoiceSettingsPayload;
          }
      > => {
        const voiceSettings = this.buildElevenLabsVoiceSettingsPayload(
          params.settings,
          omitKeys,
        );
        const requestBody = {
          text: params.text,
          model_id: 'eleven_multilingual_v2',
          ...(voiceSettings ? { voice_settings: voiceSettings } : {}),
        };

        const response = await this.runWithAbortableTimeout({
          label: 'ElevenLabs voice generation',
          timeoutMs,
          run: async (signal) =>
            fetch(
              `https://api.elevenlabs.io/v1/text-to-speech/${params.voiceId}`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Accept: 'audio/mpeg',
                  'xi-api-key': this.elevenApiKey,
                },
                body: JSON.stringify(requestBody),
                signal,
              } as any,
            ),
        });

        if (!response.ok) {
          return {
            ok: false,
            status: response.status,
            statusText: response.statusText,
            errorText: await response.text().catch(() => ''),
            omittedKeys: [...omitKeys],
            payload: voiceSettings,
          };
        }

        const arrayBuffer = await response.arrayBuffer();
        return { ok: true, buffer: Buffer.from(arrayBuffer) };
      };

      const firstAttempt = await requestSpeech();
      if (firstAttempt.ok) {
        return firstAttempt.buffer;
      }

      let finalFailure = firstAttempt;
      const fallbackOmitKeys: Array<keyof ElevenLabsVoiceSettings> = [];
      if (typeof params.settings?.style === 'number') {
        fallbackOmitKeys.push('style');
      }
      if (typeof params.settings?.speed === 'number') {
        fallbackOmitKeys.push('speed');
      }

      if (firstAttempt.status === 400 && fallbackOmitKeys.length > 0) {
        const retryAttempt = await requestSpeech(fallbackOmitKeys);
        if (retryAttempt.ok) {
          console.warn(
            'ElevenLabs accepted voice generation only after dropping optional settings',
            {
              voiceId: params.voiceId,
              omittedKeys: fallbackOmitKeys,
              initialError: this.extractApiErrorMessage(
                firstAttempt.errorText,
              ),
            },
          );
          return retryAttempt.buffer;
        }
        finalFailure = retryAttempt;
      }

      console.error('ElevenLabs TTS failed', {
        status: finalFailure.status,
        statusText: finalFailure.statusText,
        body: finalFailure.errorText,
        omittedKeys: finalFailure.omittedKeys,
        payload: finalFailure.payload,
      });

      if (finalFailure.status === 400) {
        const providerMessage = this.extractApiErrorMessage(
          finalFailure.errorText,
        );
        throw new BadRequestException(
          providerMessage
            ? `ElevenLabs rejected the requested voice settings: ${providerMessage}`
            : 'Invalid request to ElevenLabs text-to-speech API',
        );
      }

      if (finalFailure.status === 401 || finalFailure.status === 403) {
        throw new UnauthorizedException(
          'Unauthorized to call ElevenLabs text-to-speech API',
        );
      }

      throw new InternalServerErrorException(
        'Failed to generate voice using ElevenLabs',
      );
    } catch (error) {
      const err: any = error;

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
      if (err?.name === 'AbortError' || this.isTimeoutError(err)) {
        throw new InternalServerErrorException(
          'ElevenLabs voice generation timed out',
        );
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
      const timeoutMs = this.getProviderTimeoutMs('google');
      const url = new URL(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          this.geminiTtsModel,
        )}:generateContent`,
      );
      url.searchParams.set('key', this.geminiApiKey);

      const response = await this.runWithAbortableTimeout({
        label: 'Gemini voice generation',
        timeoutMs,
        run: async (signal) =>
          fetch(url.toString(), {
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
                          `Style Instructions (do NOT speak these instructions): ${style}\n\n` +
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
            signal,
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
          throw new UnauthorizedException(
            'Unauthorized to call Gemini TTS API',
          );
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
          const rateRaw =
            parsed.params['rate'] ??
            parsed.params['samplerate'] ??
            parsed.params['sample_rate'];
          const channelsRaw =
            parsed.params['channels'] ?? parsed.params['channel'];
          const sampleRate = Number.parseInt(String(rateRaw ?? ''), 10);
          const channels = Number.parseInt(String(channelsRaw ?? ''), 10);

          const wav = this.pcm16leToWav({
            pcm: audioBytes,
            sampleRate: Number.isFinite(sampleRate) ? sampleRate : 24000,
            channels: Number.isFinite(channels) ? channels : 1,
          });
          return {
            buffer: wav,
            mimeType: 'audio/wav',
            filename: 'voice-over.wav',
          };
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
        return {
          buffer: audioBytes,
          mimeType: 'audio/mpeg',
          filename: 'voice-over.mp3',
        };
      }

      if (this.looksLikeWav(audioBytes)) {
        return {
          buffer: audioBytes,
          mimeType: 'audio/wav',
          filename: 'voice-over.wav',
        };
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

      if (
        err instanceof BadRequestException ||
        err instanceof UnauthorizedException
      ) {
        throw err;
      }
      if (err?.name === 'AbortError' || this.isTimeoutError(err)) {
        throw new InternalServerErrorException(
          'Gemini voice generation timed out',
        );
      }

      throw new InternalServerErrorException(
        'Unexpected error while generating voice with Gemini TTS',
      );
    }
  }
}
