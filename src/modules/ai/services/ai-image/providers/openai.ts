import { InternalServerErrorException } from '@nestjs/common';
import { downloadImageToBuffer } from '../image-bytes';
import type { ImagePayload } from '../types';

export const generateWithOpenAi = async (params: {
  openai: any;
  imageModel: string;
  prompt: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
}): Promise<ImagePayload> => {
  if (!params.openai) {
    throw new InternalServerErrorException(
      'OPENAI_API_KEY is not configured on the server',
    );
  }

  const primarySize =
    params.aspectRatio === '1:1'
      ? '1024x1024'
      : params.aspectRatio === '9:16'
        ? '1024x1792'
        : '1792x1024';
  const fallbackSize = '1024x1024';

  const generateWithSize = async (size: string) =>
    params.openai.images.generate({
      model: params.imageModel as any,
      prompt: params.prompt,
      size: size as any,
    } as any);

  let openAiResponse: any;
  try {
    openAiResponse = await generateWithSize(primarySize);
  } catch {
    openAiResponse = await generateWithSize(fallbackSize);
  }

  const first = openAiResponse?.data?.[0];
  let buffer: Buffer | null = null;
  let base64: string | null = null;

  if (first?.b64_json || first?.b64) {
    base64 = String(first?.b64_json ?? first?.b64);
    buffer = Buffer.from(base64, 'base64');
  } else if (first?.url) {
    const url = String(first.url);
    buffer = await downloadImageToBuffer(url, 'OpenAI');
    base64 = buffer.toString('base64');
  }

  if (!buffer || !base64) {
    throw new InternalServerErrorException(
      'OpenAI image generation did not return an image',
    );
  }

  return { buffer, base64 };
};
