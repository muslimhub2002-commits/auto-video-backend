import { GoogleGenAI } from '@google/genai';
import { InternalServerErrorException } from '@nestjs/common';
import { downloadImageToBuffer } from '../image-bytes';
import type { ImagePayload } from '../types';

export const generateWithImagen = async (params: {
  geminiApiKey: string | null | undefined;
  imageModel: 'imagen-3' | 'imagen-4' | 'imagen-4-ultra';
  prompt: string;
  isShortForm: boolean;
}): Promise<ImagePayload> => {
  if (!params.geminiApiKey) {
    throw new InternalServerErrorException(
      'GEMINI_API_KEY is not configured on the server',
    );
  }

  const ai = new GoogleGenAI({ apiKey: params.geminiApiKey });

  const imagenModelCandidates = (() => {
    if (params.imageModel === 'imagen-4') {
      return [
        String(process.env.GEMINI_IMAGEN_4_MODEL ?? '').trim(),
        'imagen-4.0-generate-001',
      ].filter(Boolean);
    }

    if (params.imageModel === 'imagen-4-ultra') {
      return [
        String(process.env.GEMINI_IMAGEN_4_ULTRA_MODEL ?? '').trim(),
        'imagen-4.0-ultra-generate-001',
      ].filter(Boolean);
    }

    const override = String(process.env.GEMINI_IMAGEN_3_MODEL ?? '').trim();
    if (override) return [override];

    return [
      'imagen-3.0-generate-002',
      'imagen-3.0-generate-001',
      'imagen-3.0-fast-generate-001',
    ];
  })();

  const aspectRatio = params.isShortForm ? '9:16' : '16:9';

  const payloadBase: any = {
    prompt: params.prompt,
    config: {
      numberOfImages: 1,
      aspectRatio,
      imageSize: '1K',
    },
  };

  const parseUpstreamJsonMessage = (err: any): any | null => {
    const msg = String(err?.message ?? '').trim();
    if (!msg) return null;
    try {
      return JSON.parse(msg);
    } catch {
      return null;
    }
  };

  const isModelNotFound = (err: any): boolean => {
    const parsed = parseUpstreamJsonMessage(err);
    const code = parsed?.error?.code ?? parsed?.code;
    const status = parsed?.error?.status ?? parsed?.status;
    const message =
      String(parsed?.error?.message ?? parsed?.message ?? err?.message ?? '') ||
      '';

    return (
      code === 404 ||
      status === 'NOT_FOUND' ||
      /is not found for API version/i.test(message) ||
      /Call ListModels/i.test(message)
    );
  };

  let imagenResponse: any = null;
  let usedImagenModelId: string | null = null;

  for (const candidate of imagenModelCandidates) {
    try {
      imagenResponse = await (ai as any).models.generateImages({
        model: candidate,
        ...payloadBase,
      });
      usedImagenModelId = candidate;
      break;
    } catch (err) {
      if (isModelNotFound(err)) continue;
      throw err;
    }
  }

  if (!imagenResponse || !usedImagenModelId) {
    const tried = imagenModelCandidates.join(', ');
    const hint =
      params.imageModel === 'imagen-3'
        ? ' Set GEMINI_IMAGEN_3_MODEL to a valid Imagen 3 model id for your account/region.'
        : '';
    throw new InternalServerErrorException(
      `No supported Imagen model id found (tried: ${tried}).${hint}`,
    );
  }

  const candidates =
    imagenResponse?.generatedImages ||
    imagenResponse?.response?.generatedImages ||
    imagenResponse?.images ||
    imagenResponse?.response?.images ||
    imagenResponse?.data?.generatedImages ||
    [];

  const first =
    Array.isArray(candidates) && candidates.length > 0 ? candidates[0] : null;
  const firstImage = first?.image ?? first;

  const coerceToBuffer = (value: any): Buffer | null => {
    if (!value) return null;
    if (Buffer.isBuffer(value)) return value;
    if (typeof value === 'string') return Buffer.from(value, 'base64');
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (Array.isArray(value)) return Buffer.from(value);
    return null;
  };

  let buffer: Buffer | null = null;
  buffer =
    coerceToBuffer(firstImage?.imageBytes) ||
    coerceToBuffer(firstImage?.bytes) ||
    coerceToBuffer(firstImage?.data);

  if (!buffer) {
    const url = String(firstImage?.url ?? firstImage?.uri ?? '').trim();
    if (url) {
      buffer = await downloadImageToBuffer(url, 'Imagen');
    }
  }

  if (!buffer) {
    console.error('Imagen image generation returned an unexpected shape', {
      model: usedImagenModelId,
      responseKeys: imagenResponse ? Object.keys(imagenResponse) : null,
    });
    throw new InternalServerErrorException(
      'Imagen image generation did not return an image',
    );
  }

  return { buffer, base64: buffer.toString('base64') };
};
