import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { GenerateVideoFromFramesDto } from '../dto/generate-video-from-frames.dto';
import { uploadBufferToCloudinary } from '../../render-videos/utils/cloudinary.utils';
import { AiRuntimeService } from './ai-runtime.service';

type UploadedImageFile = {
  buffer?: Buffer;
  mimetype?: string;
  size?: number;
  originalname?: string;
};

@Injectable()
export class AiVideoService {
  constructor(private readonly runtime: AiRuntimeService) {}

  private get geminiApiKey() {
    return this.runtime.geminiApiKey;
  }

  async listGoogleModels(params?: { query?: string }): Promise<{ models: any[] }> {
    if (!this.geminiApiKey) {
      throw new InternalServerErrorException(
        'GEMINI_API_KEY is not configured on the server',
      );
    }

    const ai = new GoogleGenAI({ apiKey: this.geminiApiKey });
    const modelsApi: any = (ai as any).models;

    const callList = async () => {
      if (typeof modelsApi?.list === 'function') return modelsApi.list({});
      if (typeof modelsApi?.listModels === 'function') return modelsApi.listModels({});
      if (typeof (ai as any).listModels === 'function') return (ai as any).listModels({});
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
      : Array.isArray((candidates as any)?.models)
        ? (candidates as any).models
        : [];

    const q = String(params?.query ?? '').trim().toLowerCase();
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

    const finalEndFrame = params.isLooping ? params.startFrame : params.endFrame;
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
          if (hasSecondFrame && isFrameParamUnsupported(fallbackErr, 'lastFrame')) {
            setSecondFrame('endFrame');
            operation = await callGenerate();
          } else if (hasSecondFrame && isFrameParamUnsupported(fallbackErr, 'endFrame')) {
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
      operation = await (ai as any).operations.getVideosOperation({ operation });
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

    const isLooping = Boolean(params.dto?.isLooping);

    const fromUploaded = (file: UploadedImageFile | undefined, label: string) => {
      if (!file) return null;
      const mimeType = String(file.mimetype ?? '').trim();
      if (!mimeType || !mimeType.startsWith('image/')) {
        throw new BadRequestException(`${label} must be an image`);
      }
      if (!file.buffer || !(file.buffer instanceof Buffer) || file.buffer.length === 0) {
        throw new BadRequestException(`${label} is missing file data`);
      }
      return { buffer: file.buffer, mimeType };
    };

    const start = fromUploaded(params.startFrameFile, 'Start frame');
    if (!start) {
      throw new BadRequestException('Start frame image is required');
    }

    const end = isLooping
      ? undefined
      : (fromUploaded(params.endFrameFile, 'End frame') ?? undefined);
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

    const uploaded = await uploadBufferToCloudinary({
      buffer: generated.buffer,
      folder: 'auto-video-generator/sentence-videos',
      resource_type: 'video',
    });

    return { videoUrl: uploaded.secure_url };
  }
}
