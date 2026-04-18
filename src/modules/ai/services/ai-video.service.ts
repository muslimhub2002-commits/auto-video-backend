import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { extname, join, sep } from 'path';
import { GoogleGenAI } from '@google/genai';
import { GenerateVideoFromFramesDto } from '../dto/generate-video-from-frames.dto';
import { AiRuntimeService } from './ai-runtime.service';
import { isLikelyImageBuffer } from './ai-image/image-bytes';

type UploadedImageFile = {
  buffer?: Buffer;
  mimetype?: string;
  size?: number;
  originalname?: string;
};

@Injectable()
export class AiVideoService {
  constructor(private readonly runtime: AiRuntimeService) {}

  private inferImageMimeType(buffer: Buffer): string {
    if (buffer.length >= 8) {
      if (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
      ) {
        return 'image/png';
      }
    }

    if (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
      return 'image/jpeg';
    }

    if (
      buffer.length >= 6 &&
      buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x38 &&
      (buffer[4] === 0x37 || buffer[4] === 0x39) &&
      buffer[5] === 0x61
    ) {
      return 'image/gif';
    }

    if (
      buffer.length >= 12 &&
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return 'image/webp';
    }

    if (
      buffer.length >= 12 &&
      buffer[4] === 0x66 &&
      buffer[5] === 0x74 &&
      buffer[6] === 0x79 &&
      buffer[7] === 0x70
    ) {
      const brand = buffer.slice(8, 12).toString('ascii');
      if (['avif', 'avis'].includes(brand)) return 'image/avif';
      if (['heic', 'heix', 'hevc', 'hevx'].includes(brand)) {
        return 'image/heic';
      }
    }

    if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
      return 'image/bmp';
    }

    return 'image/png';
  }

  private normalizeUploadedImage(
    file: UploadedImageFile | undefined,
    label: string,
  ) {
    if (!file) return null;
    if (
      !file.buffer ||
      !(file.buffer instanceof Buffer) ||
      file.buffer.length === 0
    ) {
      throw new BadRequestException(`${label} is missing file data`);
    }

    const mimeType = String(file.mimetype ?? '')
      .trim()
      .toLowerCase();
    if (mimeType.startsWith('image/')) {
      return { buffer: file.buffer, mimeType };
    }

    if (!isLikelyImageBuffer(file.buffer)) {
      throw new BadRequestException(`${label} must be an image`);
    }

    return {
      buffer: file.buffer,
      mimeType: this.inferImageMimeType(file.buffer),
    };
  }

  private get geminiApiKey() {
    return this.runtime.geminiApiKey;
  }

  private get grokApiKey() {
    return this.runtime.grokApiKey;
  }

  private isGrokVideoModel(model?: string | null): boolean {
    const m = String(model ?? '')
      .trim()
      .toLowerCase();
    return m === 'grok-imagine-video' || m.startsWith('grok-');
  }

  private async xaiGenerateVideo(params: {
    prompt: string;
    model?: string;
    durationSeconds?: number;
    resolution?: string;
    aspectRatio?: string;
    image?: { buffer: Buffer; mimeType: string };
  }): Promise<{ buffer: Buffer; mimeType: string; uri: string }> {
    if (!this.grokApiKey) {
      throw new InternalServerErrorException(
        'GROK_API_KEY is not configured on the server',
      );
    }

    const prompt = String(params.prompt ?? '').trim();
    if (!prompt) {
      throw new BadRequestException('Prompt is required to generate a video');
    }

    const model = String(params.model ?? '').trim() || 'grok-imagine-video';
    const duration =
      typeof params.durationSeconds === 'number' &&
      Number.isFinite(params.durationSeconds)
        ? params.durationSeconds
        : 6;

    const payload: any = {
      prompt,
      model,
      duration,
    };

    const aspectRatio = String(params.aspectRatio ?? '').trim();
    if (aspectRatio) payload.aspect_ratio = aspectRatio;

    const resolution = String(params.resolution ?? '').trim();
    if (resolution) payload.resolution = resolution;

    if (params.image) {
      const mt = String(params.image.mimeType ?? '').trim() || 'image/png';
      const dataUrl = `data:${mt};base64,${params.image.buffer.toString('base64')}`;
      payload.image = { url: dataUrl };
    }

    const base = 'https://api.x.ai/v1';
    const headers = {
      Authorization: `Bearer ${this.grokApiKey}`,
      'Content-Type': 'application/json',
    };

    const startRes = await fetch(`${base}/videos/generations`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!startRes.ok) {
      const text = await startRes.text().catch(() => '');
      throw new InternalServerErrorException(
        `xAI video generation failed: ${startRes.status} ${startRes.statusText}${text ? ` — ${text}` : ''}`,
      );
    }

    const startJson: any = await startRes.json().catch(() => null);
    const requestId = String(startJson?.request_id ?? '').trim();
    if (!requestId) {
      throw new InternalServerErrorException(
        'xAI video generation started but no request_id was returned',
      );
    }

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const maxAttempts = 90; // ~6 minutes @ 4s interval
    const intervalMs = 4_000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const pollRes = await fetch(
        `${base}/videos/${encodeURIComponent(requestId)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.grokApiKey}` },
        },
      );

      if (pollRes.status === 202) {
        await sleep(intervalMs);
        continue;
      }

      if (!pollRes.ok) {
        const text = await pollRes.text().catch(() => '');
        throw new InternalServerErrorException(
          `xAI video polling failed: ${pollRes.status} ${pollRes.statusText}${text ? ` — ${text}` : ''}`,
        );
      }

      const pollJson: any = await pollRes.json().catch(() => null);
      const video = pollJson?.video ?? pollJson?.response?.video ?? null;
      const url = String(video?.url ?? '').trim();
      const respectsModeration =
        typeof video?.respect_moderation === 'boolean'
          ? video.respect_moderation
          : true;

      if (!respectsModeration && !url) {
        throw new InternalServerErrorException(
          'xAI video was generated but was blocked by moderation',
        );
      }

      if (!url) {
        // Some deployments may return 200 with an incomplete body; retry.
        await sleep(intervalMs);
        continue;
      }

      const videoRes = await fetch(url);
      if (!videoRes.ok) {
        throw new InternalServerErrorException(
          `Failed to fetch xAI generated video: ${videoRes.status} ${videoRes.statusText}`,
        );
      }

      const mimeType = videoRes.headers.get('content-type') || 'video/mp4';
      const arrayBuffer = await videoRes.arrayBuffer();
      return {
        buffer: Buffer.from(arrayBuffer),
        mimeType,
        uri: url,
      };
    }

    throw new InternalServerErrorException(
      'Timed out while waiting for xAI video generation to complete',
    );
  }

  async listGoogleModels(params?: {
    query?: string;
  }): Promise<{ models: any[] }> {
    if (!this.geminiApiKey) {
      throw new InternalServerErrorException(
        'GEMINI_API_KEY is not configured on the server',
      );
    }

    const ai = new GoogleGenAI({ apiKey: this.geminiApiKey });
    const modelsApi: any = (ai as any).models;

    const callList = async () => {
      if (typeof modelsApi?.list === 'function') return modelsApi.list({});
      if (typeof modelsApi?.listModels === 'function')
        return modelsApi.listModels({});
      if (typeof (ai as any).listModels === 'function')
        return (ai as any).listModels({});
      throw new InternalServerErrorException(
        'GoogleGenAI ListModels is not available in this SDK version',
      );
    };

    const raw = await callList();
    const candidates =
      raw?.models ||
      raw?.response?.models ||
      raw?.data?.models ||
      raw?.data ||
      raw;

    const models: any[] = Array.isArray(candidates)
      ? candidates
      : Array.isArray(candidates?.models)
        ? candidates.models
        : [];

    const q = String(params?.query ?? '')
      .trim()
      .toLowerCase();
    const filtered = q
      ? models.filter((m) => {
          const name = String(m?.name ?? m?.id ?? '').toLowerCase();
          const display = String(m?.displayName ?? '').toLowerCase();
          const desc = String(m?.description ?? '').toLowerCase();
          return name.includes(q) || display.includes(q) || desc.includes(q);
        })
      : models;

    return { models: filtered };
  }

  async generateVideoFromFrames(params: {
    prompt: string;
    model?: string;
    resolution?: string;
    aspectRatio?: string;
    isLooping?: boolean;
    startFrame: { buffer: Buffer; mimeType: string };
    endFrame?: { buffer: Buffer; mimeType: string };
  }): Promise<{ buffer: Buffer; mimeType: string; uri: string }> {
    if (!this.geminiApiKey) {
      throw new InternalServerErrorException(
        'GEMINI_API_KEY is not configured on the server',
      );
    }

    const prompt = String(params.prompt ?? '').trim();
    if (!prompt) {
      throw new BadRequestException('Prompt is required to generate a video');
    }

    const ai = new GoogleGenAI({ apiKey: this.geminiApiKey });

    const config: any = {
      numberOfVideos: 1,
      resolution: String(params.resolution ?? '').trim() || '720p',
    };

    // Default to portrait (shorts/reels) if not specified.
    const aspectRatio = String(params.aspectRatio ?? '').trim() || '9:16';
    config.aspectRatio = aspectRatio;

    const requestedModelRaw =
      String(params.model ?? '').trim() ||
      String(process.env.GEMINI_VIDEO_MODEL ?? '').trim();

    const requestedModel = requestedModelRaw || 'veo-3.0-fast-generate-001';

    const finalEndFrame = params.isLooping
      ? params.startFrame
      : params.endFrame;
    const hasSecondFrame = Boolean(finalEndFrame);

    // Veo 3 uses `endFrame` while older variants use `lastFrame`.
    const preferredSecondFrameKey: 'endFrame' | 'lastFrame' = requestedModel
      .toLowerCase()
      .startsWith('veo-3')
      ? 'endFrame'
      : 'lastFrame';

    const payload: any = {
      model: requestedModel,
      config,
      prompt,
      image: {
        imageBytes: params.startFrame.buffer.toString('base64'),
        mimeType: params.startFrame.mimeType,
      },
    };

    const setSecondFrame = (key: 'endFrame' | 'lastFrame' | null) => {
      delete payload.config.endFrame;
      delete payload.config.lastFrame;
      if (!finalEndFrame || !key) return;
      payload.config[key] = {
        imageBytes: finalEndFrame.buffer.toString('base64'),
        mimeType: finalEndFrame.mimeType,
      };
    };

    setSecondFrame(hasSecondFrame ? preferredSecondFrameKey : null);

    const isFrameParamUnsupported = (
      err: unknown,
      paramName: 'lastFrame' | 'endFrame',
    ) => {
      const msg =
        typeof err === 'object' && err !== null && 'message' in err
          ? String((err as any).message)
          : '';
      return (
        (msg.includes('`' + paramName + '`') || msg.includes(paramName)) &&
        (msg.includes("isn't supported") || msg.includes('is not supported'))
      );
    };

    const isModelNotFound = (err: unknown) => {
      const msg =
        typeof err === 'object' && err !== null && 'message' in err
          ? String((err as any).message)
          : '';
      return (
        msg.toLowerCase().includes('not found') ||
        (msg.toLowerCase().includes('model') &&
          msg.toLowerCase().includes('not') &&
          msg.toLowerCase().includes('available')) ||
        msg.includes('404')
      );
    };

    let operation;
    const callGenerate = () => (ai as any).models.generateVideos(payload);

    try {
      operation = await callGenerate();
    } catch (err: unknown) {
      if (hasSecondFrame && isFrameParamUnsupported(err, 'lastFrame')) {
        setSecondFrame('endFrame');
        operation = await callGenerate();
      } else if (hasSecondFrame && isFrameParamUnsupported(err, 'endFrame')) {
        setSecondFrame('lastFrame');
        operation = await callGenerate();
      } else if (payload.model === requestedModel && isModelNotFound(err)) {
        payload.model = 'veo-2.0-generate-001';
        if (hasSecondFrame) setSecondFrame('lastFrame');
        try {
          operation = await callGenerate();
        } catch (fallbackErr: unknown) {
          if (
            hasSecondFrame &&
            isFrameParamUnsupported(fallbackErr, 'lastFrame')
          ) {
            setSecondFrame('endFrame');
            operation = await callGenerate();
          } else if (
            hasSecondFrame &&
            isFrameParamUnsupported(fallbackErr, 'endFrame')
          ) {
            setSecondFrame('lastFrame');
            operation = await callGenerate();
          } else {
            throw fallbackErr;
          }
        }
      } else {
        throw err;
      }
    }

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    while (!operation.done) {
      await sleep(10_000);
      operation = await (ai as any).operations.getVideosOperation({
        operation,
      });
    }

    const videos = operation?.response?.generatedVideos;
    const first = Array.isArray(videos) && videos.length > 0 ? videos[0] : null;
    const uriRaw = first?.video?.uri;
    if (!uriRaw) {
      throw new InternalServerErrorException('No videos generated');
    }

    const uri = decodeURIComponent(String(uriRaw));
    const urlWithKey = `${uri}${uri.includes('?') ? '&' : '?'}key=${encodeURIComponent(
      this.geminiApiKey,
    )}`;

    const res = await fetch(urlWithKey);
    if (!res.ok) {
      throw new InternalServerErrorException(
        `Failed to fetch generated video: ${res.status} ${res.statusText}`,
      );
    }

    const mimeType = res.headers.get('content-type') || 'video/mp4';
    const arrayBuffer = await res.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType,
      uri,
    };
  }

  async generateVideoFromTextRaw(params: {
    prompt: string;
    model?: string;
    resolution?: string;
    aspectRatio?: string;
  }): Promise<{ buffer: Buffer; mimeType: string; uri: string }> {
    if (!this.geminiApiKey) {
      throw new InternalServerErrorException(
        'GEMINI_API_KEY is not configured on the server',
      );
    }

    const prompt = String(params.prompt ?? '').trim();
    if (!prompt) {
      throw new BadRequestException('Prompt is required to generate a video');
    }

    const ai = new GoogleGenAI({ apiKey: this.geminiApiKey });

    const config: any = {
      numberOfVideos: 1,
      resolution: String(params.resolution ?? '').trim() || '720p',
    };

    const aspectRatio = String(params.aspectRatio ?? '').trim() || '9:16';
    config.aspectRatio = aspectRatio;

    const requestedModelRaw =
      String(params.model ?? '').trim() ||
      String(process.env.GEMINI_VIDEO_MODEL ?? '').trim();

    const requestedModel = requestedModelRaw || 'veo-3.0-fast-generate-001';

    const payload: any = {
      model: requestedModel,
      config,
      prompt,
    };

    const isModelNotFound = (err: unknown) => {
      const msg =
        typeof err === 'object' && err !== null && 'message' in err
          ? String((err as any).message)
          : '';
      return (
        msg.toLowerCase().includes('not found') ||
        (msg.toLowerCase().includes('model') &&
          msg.toLowerCase().includes('not') &&
          msg.toLowerCase().includes('available')) ||
        msg.includes('404')
      );
    };

    let operation;
    const callGenerate = () => (ai as any).models.generateVideos(payload);

    try {
      operation = await callGenerate();
    } catch (err: unknown) {
      if (payload.model === requestedModel && isModelNotFound(err)) {
        payload.model = 'veo-2.0-generate-001';
        operation = await callGenerate();
      } else {
        throw err;
      }
    }

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    while (!operation.done) {
      await sleep(10_000);
      operation = await (ai as any).operations.getVideosOperation({
        operation,
      });
    }

    const videos = operation?.response?.generatedVideos;
    const first = Array.isArray(videos) && videos.length > 0 ? videos[0] : null;
    const uriRaw = first?.video?.uri;
    if (!uriRaw) {
      throw new InternalServerErrorException('No videos generated');
    }

    const uri = decodeURIComponent(String(uriRaw));
    const urlWithKey = `${uri}${uri.includes('?') ? '&' : '?'}key=${encodeURIComponent(
      this.geminiApiKey,
    )}`;

    const res = await fetch(urlWithKey);
    if (!res.ok) {
      throw new InternalServerErrorException(
        `Failed to fetch generated video: ${res.status} ${res.statusText}`,
      );
    }

    const mimeType = res.headers.get('content-type') || 'video/mp4';
    const arrayBuffer = await res.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType,
      uri,
    };
  }

  async generateVideoFromUploadedFrames(params: {
    userId: string;
    dto: GenerateVideoFromFramesDto;
    startFrameFile?: UploadedImageFile;
    endFrameFile?: UploadedImageFile;
  }): Promise<{ videoUrl: string }> {
    const prompt = String(params.dto?.prompt ?? '').trim();
    if (!prompt) {
      throw new BadRequestException('Prompt is required');
    }

    if (this.isGrokVideoModel(params.dto?.model)) {
      throw new BadRequestException(
        'Grok video generation does not support frames mode. Use text or reference image mode.',
      );
    }

    const isLooping = Boolean(params.dto?.isLooping);

    const start = this.normalizeUploadedImage(
      params.startFrameFile,
      'Start frame',
    );
    if (!start) {
      throw new BadRequestException('Start frame image is required');
    }

    const end = isLooping
      ? undefined
      : (this.normalizeUploadedImage(params.endFrameFile, 'End frame') ??
        undefined);
    if (!isLooping && !end) {
      throw new BadRequestException('End frame image is required');
    }

    const generated = await this.generateVideoFromFrames({
      prompt,
      model: params.dto?.model,
      resolution: params.dto?.resolution,
      aspectRatio: params.dto?.aspectRatio,
      isLooping,
      startFrame: start,
      endFrame: end,
    });

    const baseUrl =
      process.env.REMOTION_ASSET_BASE_URL ??
      `http://127.0.0.1:${process.env.PORT ?? 3000}`;

    const fromMime = () => {
      const mt = String(generated.mimeType ?? '').toLowerCase();
      if (mt.includes('webm')) return '.webm';
      if (mt.includes('quicktime')) return '.mov';
      return '.mp4';
    };

    const ext = extname(String(generated.uri ?? '').trim()) || fromMime();
    const fileName = `${randomUUID()}${ext}`;
    const relPath = join('sentence-videos', fileName);
    const absDir = join(process.cwd(), 'storage', 'sentence-videos');
    fs.mkdirSync(absDir, { recursive: true });
    fs.writeFileSync(join(process.cwd(), 'storage', relPath), generated.buffer);

    const normalized = relPath.split(sep).join('/');
    return { videoUrl: `${baseUrl}/static/${normalized}` };
  }

  async generateVideoFromText(params: {
    userId: string;
    dto: {
      prompt: string;
      model?: string;
      resolution?: string;
      aspectRatio?: string;
    };
  }): Promise<{ videoUrl: string }> {
    const prompt = String(params.dto?.prompt ?? '').trim();
    if (!prompt) {
      throw new BadRequestException('Prompt is required');
    }

    const generated = this.isGrokVideoModel(params.dto?.model)
      ? await this.xaiGenerateVideo({
          prompt,
          model: params.dto?.model,
          durationSeconds: 6,
          resolution: params.dto?.resolution,
          aspectRatio: params.dto?.aspectRatio,
        })
      : await this.generateVideoFromTextRaw({
          prompt,
          model: params.dto?.model,
          resolution: params.dto?.resolution,
          aspectRatio: params.dto?.aspectRatio,
        });

    const baseUrl =
      process.env.REMOTION_ASSET_BASE_URL ??
      `http://127.0.0.1:${process.env.PORT ?? 3000}`;

    const fromMime = () => {
      const mt = String(generated.mimeType ?? '').toLowerCase();
      if (mt.includes('webm')) return '.webm';
      if (mt.includes('quicktime')) return '.mov';
      return '.mp4';
    };

    const ext = extname(String(generated.uri ?? '').trim()) || fromMime();
    const fileName = `${randomUUID()}${ext}`;
    const relPath = join('sentence-videos', fileName);
    const absDir = join(process.cwd(), 'storage', 'sentence-videos');
    fs.mkdirSync(absDir, { recursive: true });
    fs.writeFileSync(join(process.cwd(), 'storage', relPath), generated.buffer);

    const normalized = relPath.split(sep).join('/');
    return { videoUrl: `${baseUrl}/static/${normalized}` };
  }

  async generateVideoFromUploadedReferenceImage(params: {
    userId: string;
    dto: {
      prompt: string;
      model?: string;
      resolution?: string;
      aspectRatio?: string;
      isLooping?: boolean;
    };
    referenceImageFile?: UploadedImageFile;
  }): Promise<{ videoUrl: string }> {
    const prompt = String(params.dto?.prompt ?? '').trim();
    if (!prompt) {
      throw new BadRequestException('Prompt is required');
    }

    const image = this.normalizeUploadedImage(
      params.referenceImageFile,
      'Reference image',
    );
    if (!image) {
      throw new BadRequestException('Reference image is required');
    }

    const isLooping = Boolean(params.dto?.isLooping);

    const generated = this.isGrokVideoModel(params.dto?.model)
      ? await this.xaiGenerateVideo({
          prompt,
          model: params.dto?.model,
          durationSeconds: 6,
          resolution: params.dto?.resolution,
          aspectRatio: params.dto?.aspectRatio,
          image,
        })
      : await this.generateVideoFromFrames({
          prompt,
          model: params.dto?.model,
          resolution: params.dto?.resolution,
          aspectRatio: params.dto?.aspectRatio,
          isLooping,
          startFrame: image,
          endFrame: undefined,
        });

    const baseUrl =
      process.env.REMOTION_ASSET_BASE_URL ??
      `http://127.0.0.1:${process.env.PORT ?? 3000}`;

    const fromMime = () => {
      const mt = String(generated.mimeType ?? '').toLowerCase();
      if (mt.includes('webm')) return '.webm';
      if (mt.includes('quicktime')) return '.mov';
      return '.mp4';
    };

    const ext = extname(String(generated.uri ?? '').trim()) || fromMime();
    const fileName = `${randomUUID()}${ext}`;
    const relPath = join('sentence-videos', fileName);
    const absDir = join(process.cwd(), 'storage', 'sentence-videos');
    fs.mkdirSync(absDir, { recursive: true });
    fs.writeFileSync(join(process.cwd(), 'storage', relPath), generated.buffer);

    const normalized = relPath.split(sep).join('/');
    return { videoUrl: `${baseUrl}/static/${normalized}` };
  }
}
