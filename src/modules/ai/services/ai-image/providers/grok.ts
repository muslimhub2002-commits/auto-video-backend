import {
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  downloadImageToBuffer,
  isLikelyImageBuffer,
  normalizeBase64Image,
} from '../image-bytes';
import type { ImagePayload } from '../types';

const XAI_BASE_URL = 'https://api.x.ai/v1';

type XAiImagesGenerationResponse = {
  data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
  error?: { message?: string };
};

async function postImagesGenerations(params: {
  apiKey: string;
  prompt: string;
  model: string;
  aspectRatio: string;
  responseFormat: 'b64_json' | 'url';
}): Promise<XAiImagesGenerationResponse> {
  const res = await fetch(`${XAI_BASE_URL}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: params.prompt,
      model: params.model,
      n: 1,
      response_format: params.responseFormat,
      aspect_ratio: params.aspectRatio,
    }),
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const message =
      (json && (json?.error?.message || json?.message)) ||
      text ||
      `xAI image generation failed with status ${res.status}`;

    if (res.status === 401 || res.status === 403) {
      throw new UnauthorizedException(message);
    }

    throw new BadRequestException(message);
  }

  return (json || {}) as XAiImagesGenerationResponse;
}

export const generateWithGrokImagine = async (params: {
  grokApiKey: string | null | undefined;
  imageModel: 'grok-imagine-image';
  prompt: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
}): Promise<ImagePayload> => {
  const apiKey = String(params.grokApiKey ?? '').trim();
  if (!apiKey) {
    throw new InternalServerErrorException(
      'GROK_API_KEY is not configured on the server',
    );
  }

  const aspectRatio = params.aspectRatio;

  // Prefer base64 (fastest: no follow-up download), but fall back to URL.
  let payload: XAiImagesGenerationResponse;
  try {
    payload = await postImagesGenerations({
      apiKey,
      prompt: params.prompt,
      model: params.imageModel,
      aspectRatio,
      responseFormat: 'b64_json',
    });
  } catch {
    payload = await postImagesGenerations({
      apiKey,
      prompt: params.prompt,
      model: params.imageModel,
      aspectRatio,
      responseFormat: 'url',
    });
  }

  const first = payload?.data?.[0];
  if (!first) {
    throw new InternalServerErrorException(
      'xAI image generation did not return an image',
    );
  }

  if (first.b64_json) {
    const { base64, buffer } = normalizeBase64Image(String(first.b64_json));
    if (!isLikelyImageBuffer(buffer)) {
      throw new InternalServerErrorException(
        'xAI returned invalid base64 image bytes',
      );
    }
    return { buffer, base64 };
  }

  if (first.url) {
    const buffer = await downloadImageToBuffer(String(first.url), 'xAI');
    const base64 = buffer.toString('base64');
    return { buffer, base64 };
  }

  throw new InternalServerErrorException(
    'xAI image generation did not return an image',
  );
};
