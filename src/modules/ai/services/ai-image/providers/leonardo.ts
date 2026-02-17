import {
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { downloadImageToBuffer } from '../image-bytes';
import type { ImagePayload } from '../types';

export const generateWithLeonardo = async (params: {
  leonardoApiKey: string | null | undefined;
  leonardoModelId: string | null | undefined;
  prompt: string;
  width: number;
  height: number;
}): Promise<{ prompt: string; image: ImagePayload }> => {
  if (!params.leonardoApiKey) {
    throw new InternalServerErrorException(
      'LEONARDO_API_KEY is not configured on the server',
    );
  }

  if (!params.leonardoModelId) {
    throw new InternalServerErrorException(
      'LEONARDO_MODEL_ID is not configured on the server',
    );
  }

  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const safeReplacementForTerm = (termRaw: string): string => {
    const t = String(termRaw ?? '')
      .trim()
      .toLowerCase();
    if (!t) return 'redacted';
    if (t === 'slave') return 'captive';
    if (t === 'slaves') return 'captives';
    if (t === 'slavery') return 'forced labor';
    if (t === 'enslaved') return 'captive';
    if (t === 'enslaves') return 'captures';
    if (t === 'enslaving') return 'capturing';
    return 'redacted';
  };

  const preSanitizeLeonardoPrompt = (input: string): string => {
    let out = String(input ?? '');
    out = out
      .replace(/\bslaves\b/gi, 'captives')
      .replace(/\bslave\b/gi, 'captive')
      .replace(/\bslavery\b/gi, 'forced labor')
      .replace(/\benslaved\b/gi, 'captive')
      .replace(/\benslaving\b/gi, 'capturing')
      .replace(/\benslaves\b/gi, 'captures');
    return out;
  };

  const extractModerationTermFromLeonardoError = (
    errorText: string,
  ): string | null => {
    const raw = String(errorText ?? '').trim();
    if (!raw) return null;

    let msg = raw;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        msg = String(parsed.error ?? parsed.message ?? raw);
      }
    } catch {
      // ignore
    }

    const m = msg.match(/referencing\s+([^\.\"\n\r]+)\.?/i);
    if (!m) return null;
    const term = String(m[1] ?? '').trim();
    return term || null;
  };

  const doCreateGeneration = async (promptForLeonardo: string) =>
    fetch('https://cloud.leonardo.ai/api/rest/v1/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.leonardoApiKey}`,
      },
      body: JSON.stringify({
        prompt: promptForLeonardo,
        modelId: params.leonardoModelId,
        width: params.width,
        height: params.height,
        num_images: 1,
      }),
    } as any);

  let leonardoPrompt = preSanitizeLeonardoPrompt(params.prompt);
  let createResponse = await doCreateGeneration(leonardoPrompt);

  if (!createResponse.ok) {
    const errorText = await createResponse.text().catch(() => '');
    if (createResponse.status === 403) {
      const term = extractModerationTermFromLeonardoError(errorText);
      if (term) {
        const replacement = safeReplacementForTerm(term);
        const replaced = leonardoPrompt.replace(
          new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi'),
          replacement,
        );

        if (replaced !== leonardoPrompt) {
          const retryResponse = await doCreateGeneration(replaced);
          if (retryResponse.ok) {
            leonardoPrompt = replaced;
            createResponse = retryResponse;
          } else {
            const retryErrorText = await retryResponse
              .text()
              .catch(() => errorText);
            console.error('Leonardo create generation failed (retry)', {
              status: retryResponse.status,
              statusText: retryResponse.statusText,
              body: retryErrorText,
            });
          }
        }
      }
    }
  }

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

    if (createResponse.status === 403) {
      const term = extractModerationTermFromLeonardoError(errorText);
      if (term) {
        throw new BadRequestException(
          `Leonardo content moderation blocked the word "${term}". The server attempted an automatic replacement but it still failed. Please rephrase the sentence/prompt.`,
        );
      }
    }

    if (createResponse.status === 401) {
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

  const delay = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  let imageUrl: string | undefined;
  const maxAttempts = 30;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const statusResponse = await fetch(
      `https://cloud.leonardo.ai/api/rest/v1/generations/${generationId}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${params.leonardoApiKey}` },
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
      console.error('Leonardo generation failed', { body: statusJson });
      break;
    }

    await delay(2000);
  }

  if (!imageUrl) {
    throw new InternalServerErrorException(
      'Timed out waiting for Leonardo image generation',
    );
  }

  const buffer = await downloadImageToBuffer(imageUrl, 'Leonardo');

  return {
    prompt: leonardoPrompt,
    image: {
      buffer,
      base64: buffer.toString('base64'),
    },
  };
};
