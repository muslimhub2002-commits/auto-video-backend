import {
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { downloadImageToBuffer, isLikelyImageBuffer, normalizeBase64Image } from '../image-bytes';
import type { ImagePayload } from '../types';

export const generateWithModelsLab = async (params: {
  apiKey: string;
  modelId: string;
  prompt: string;
  isShortForm: boolean;
}): Promise<ImagePayload> => {
  const apiKey = String(params.apiKey ?? '').trim();
  if (!apiKey) {
    throw new InternalServerErrorException('STABLE_DIFFUSION_API_KEY is not configured on the server');
  }

  const modelId = String(params.modelId ?? '').trim();
  if (!modelId) {
    throw new BadRequestException('Invalid ModelsLab imageModel. Expected format: modelslab:<model_id>');
  }

  const sdWidth = params.isShortForm ? 576 : 1024;
  const sdHeight = params.isShortForm ? 1024 : 576;

  const isFluxFamily = /^flux/i.test(modelId);

  const textToImageUrl = isFluxFamily
    ? 'https://modelslab.com/api/v7/images/text-to-image'
    : 'https://modelslab.com/api/v6/images/text2img';

  const requestBody: any = {
    key: apiKey,
    model_id: modelId,
    prompt: params.prompt,
    width: sdWidth,
    height: sdHeight,
  };

  if (!isFluxFamily) {
    requestBody.samples = 1;
    requestBody.num_inference_steps = 20;
    requestBody.guidance_scale = 7.5;
    requestBody.base64 = true;
    requestBody.safety_checker = false;
    requestBody.negative_prompt = '';
    requestBody.enhance_prompt = true;
  }

  const resp = await fetch(textToImageUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  } as any);

  let json: any = null;
  let errorText: string = '';
  try {
    json = await resp.json();
  } catch {
    errorText = await resp.text().catch(() => '');
  }

  const coerceDetail = (payload: any): { status: string; id: string | null; detail: string } => {
    const status = String(payload?.status ?? '').toLowerCase();
    const id = payload?.id != null ? String(payload.id) : null;
    const msg = String(
      payload?.message ??
        payload?.error ??
        payload?.error_message ??
        payload?.errorMessage ??
        '',
    ).trim();
    const tip = String(payload?.tip ?? '').trim();
    const detail = [msg, tip].filter(Boolean).join(' — ');
    return { status, id, detail };
  };

  if (!resp.ok && !json) {
    console.error('ModelsLab text2img failed (non-JSON)', {
      status: resp.status,
      statusText: resp.statusText,
      body: errorText,
      model_id: modelId,
    });
    throw new InternalServerErrorException('Failed to generate image using Stable Diffusion (ModelsLab)');
  }

  const initial = json ?? {};
  let { status, id, detail } = coerceDetail(initial);

  if (status === 'processing' && id) {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    let fetchUrl = isFluxFamily
      ? `https://modelslab.com/api/v7/images/fetch/${encodeURIComponent(id)}`
      : `https://modelslab.com/api/v6/images/fetch/${encodeURIComponent(id)}`;
    const fallbackFetchUrl = `https://modelslab.com/api/v6/images/fetch/${encodeURIComponent(id)}`;
    const maxAttempts = 25;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await delay(2000);

      let fetchResp = await fetch(fetchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey }),
      } as any);

      if (fetchResp.status === 404 && fetchUrl !== fallbackFetchUrl) {
        fetchUrl = fallbackFetchUrl;
        fetchResp = await fetch(fetchUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: apiKey }),
        } as any);
      }

      let fetchJson: any = null;
      let fetchText = '';
      try {
        fetchJson = await fetchResp.json();
      } catch {
        fetchText = await fetchResp.text().catch(() => '');
      }

      if (!fetchResp.ok && !fetchJson) {
        console.error('ModelsLab fetch failed (non-JSON)', {
          status: fetchResp.status,
          statusText: fetchResp.statusText,
          body: fetchText,
          id,
          model_id: modelId,
        });
        break;
      }

      const fetched = fetchJson ?? {};
      const parsed = coerceDetail(fetched);
      status = parsed.status;
      detail = parsed.detail;

      if (status === 'success') {
        json = fetched;
        break;
      }

      if (status !== 'processing') {
        json = fetched;
        break;
      }
    }

    if (!json || String(json?.status ?? '').toLowerCase() !== 'success') {
      console.error('ModelsLab async generation did not complete', {
        id,
        status,
        detail: detail || null,
        model_id: modelId,
      });
      throw new InternalServerErrorException(detail || 'Stable Diffusion (ModelsLab) did not finish in time');
    }
  }

  ({ status, id, detail } = coerceDetail(json));
  if (status !== 'success') {
    console.error('ModelsLab text2img non-success response', {
      status,
      id: id ?? null,
      detail: detail || null,
      model_id: modelId,
      httpStatus: resp.status,
    });

    if (/invalid\s+api\s*key|unauthorized|forbidden/i.test(detail)) {
      throw new UnauthorizedException(detail || 'ModelsLab request was unauthorized');
    }

    throw new BadRequestException(
      detail || `Stable Diffusion (ModelsLab) returned a non-success status: ${status || 'unknown'}`,
    );
  }

  const output0 =
    (Array.isArray(json?.output) && json.output.length > 0 ? json.output[0] : null) ??
    (Array.isArray(json?.proxy_links) && json.proxy_links.length > 0 ? json.proxy_links[0] : null);

  const candidateStrings: string[] = [];
  const pushCandidate = (value: any) => {
    if (typeof value === 'string' && value.trim()) {
      candidateStrings.push(value.trim());
    }
  };
  const collectFromArray = (arr: any[]) => {
    for (const item of arr) {
      if (typeof item === 'string') {
        pushCandidate(item);
        continue;
      }
      if (item && typeof item === 'object') {
        pushCandidate((item as any).url);
        pushCandidate((item as any).link);
        pushCandidate((item as any).image);
        pushCandidate((item as any).base64);
        pushCandidate((item as any).b64);
        pushCandidate((item as any).b64_json);
      }
    }
  };

  if (Array.isArray(json?.output)) collectFromArray(json.output);
  if (Array.isArray(json?.proxy_links)) collectFromArray(json.proxy_links);
  pushCandidate(output0);

  if (candidateStrings.length === 0) {
    throw new InternalServerErrorException('Stable Diffusion (ModelsLab) did not return an image');
  }

  let imgBuffer: Buffer | null = null;
  let base64: string | null = null;
  let lastProblem: string | null = null;

  for (const candidate of candidateStrings) {
    try {
      if (/^https?:\/\//i.test(candidate)) {
        const buf = await downloadImageToBuffer(candidate, 'ModelsLab');
        if (!isLikelyImageBuffer(buf)) {
          lastProblem = 'downloaded bytes did not look like an image';
          continue;
        }
        imgBuffer = buf;
        base64 = buf.toString('base64');
        break;
      }

      const decoded = normalizeBase64Image(candidate);
      if (!isLikelyImageBuffer(decoded.buffer)) {
        lastProblem = 'base64 decoded bytes did not look like an image';
        continue;
      }
      imgBuffer = decoded.buffer;
      base64 = decoded.base64;
      break;
    } catch (e: any) {
      lastProblem = String(e?.message ?? e) || 'failed to parse image candidate';
      continue;
    }
  }

  if (!imgBuffer || !base64) {
    console.error('ModelsLab did not provide a valid image payload', {
      model_id: modelId,
      lastProblem,
      candidates: candidateStrings.slice(0, 5),
    });
    throw new InternalServerErrorException('Stable Diffusion (ModelsLab) did not return a usable image');
  }

  return { buffer: imgBuffer, base64 };
};
