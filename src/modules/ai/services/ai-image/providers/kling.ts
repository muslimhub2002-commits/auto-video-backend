import {
    BadRequestException,
    InternalServerErrorException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { downloadImageToBuffer } from '../image-bytes';
import type { ImagePayload } from '../types';

export type KlingImageModel = string;

/**
 * Kling image generation models documented at:
 *   - https://kling.ai/document-api/api/image/3-0-omni/image-generation (kling-3.0-omni)
 *   - https://kling.ai/document-api/api/image/o1/image-generation       (kling-o1)
 *   - https://kling.ai/document-api/pricing/base/image
 *   - https://kling.ai/document-api/api/get-started/authentication
 *
 * The API uses the same JWT auth flow as the video API:
 *   - access key  = KLING_API_KEY
 *   - secret key  = KLING_SECRET_KEY
 *   - HS256-signed JWT with { iss, exp, nbf }
 *
 * Flow:
 *   1. POST /v1/images/generations  → creates an async task
 *   2. GET  /v1/images/generations/{task_id}  → poll until status === "succeed"
 *   3. Download the returned image URL
 *
 * Supported model_name values include: kling-3.0-omni, kling-o1, kling-v3.
 * The O1 model is a reasoning model and may take longer; the poll loop uses
 * an adaptive timeout based on the model.
 */
export const generateWithKling = async (params: {
    klingApiKey: string | null | undefined;
    klingSecretKey: string | null | undefined;
    imageModel: KlingImageModel;
    prompt: string;
    aspectRatio: '16:9' | '9:16' | '1:1';
}): Promise<ImagePayload> => {
    const accessKey = String(params.klingApiKey ?? '').trim();
    const secretKey = String(params.klingSecretKey ?? '').trim();

    if (!accessKey || !secretKey) {
        throw new InternalServerErrorException(
            'KLING_API_KEY or KLING_SECRET_KEY is not configured on the server',
        );
    }

    const prompt = String(params.prompt ?? '').trim();
    if (!prompt) {
        throw new BadRequestException('Prompt is required to generate a Kling image');
    }

    const modelName =
        String(params.imageModel ?? '').trim() || 'kling-v1';

    // O1 is a reasoning model — allow more polling time for it.
    const isO1Model = modelName.toLowerCase().includes('o1');
    const maxAttempts = isO1Model ? 120 : 60;
    const pollIntervalMs = isO1Model ? 5_000 : 3_000;

    const createAuthorizationToken = (): string => {
        const nowSeconds = Math.floor(Date.now() / 1000);
        return jwt.sign(
            {
                iss: accessKey,
                exp: nowSeconds + 1800,
                nbf: nowSeconds - 5,
            },
            secretKey,
            {
                algorithm: 'HS256',
                header: {
                    alg: 'HS256',
                    typ: 'JWT',
                },
                noTimestamp: true,
            },
        );
    };

    const body: Record<string, unknown> = {
        model_name: modelName,
        prompt,
        aspect_ratio: params.aspectRatio,
        image_size: '1K',
    };

    const authorization = createAuthorizationToken();

    const createRes = await fetch(
        'https://api-singapore.klingai.com/v1/images/generations',
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${authorization}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        } as any,
    );

    const createJson: any = await createRes.json().catch(() => null);

    if (!createRes.ok || Number(createJson?.code ?? -1) !== 0) {
        const message = String(createJson?.message ?? '').trim();
        console.error('Kling image task creation failed', {
            status: createRes.status,
            statusText: createRes.statusText,
            body: createJson,
        });

        if (createRes.status === 400) {
            throw new BadRequestException(
                `Invalid request to Kling image generation API${message ? `: ${message}` : ''
                }`,
            );
        }

        throw new InternalServerErrorException(
            `Kling image task creation failed: ${createRes.status} ${createRes.statusText}${message ? ` — ${message}` : ''
            }`,
        );
    }

    const taskId = String(createJson?.data?.task_id ?? '').trim();
    if (!taskId) {
        console.error('Kling image task creation unexpected response', {
            body: createJson,
        });
        throw new InternalServerErrorException(
            'Kling image task creation succeeded but no task_id was returned',
        );
    }

    const sleep = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));

    const pollAuthorization = createAuthorizationToken();

    let imageUrl: string | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const pollRes = await fetch(
            `https://api-singapore.klingai.com/v1/images/generations/${encodeURIComponent(
                taskId,
            )}`,
            {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${pollAuthorization}`,
                },
            } as any,
        );

        const pollJson: any = await pollRes.json().catch(() => null);

        if (!pollRes.ok || Number(pollJson?.code ?? -1) !== 0) {
            const message = String(pollJson?.message ?? '').trim();
            console.error('Kling image task polling failed', {
                status: pollRes.status,
                statusText: pollRes.statusText,
                body: pollJson,
            });
            throw new InternalServerErrorException(
                `Kling image task polling failed: ${pollRes.status} ${pollRes.statusText}${message ? ` — ${message}` : ''
                }`,
            );
        }

        const status = String(
            pollJson?.data?.task_status ?? '',
        )
            .trim()
            .toLowerCase();

        if (status === 'succeed' || status === 'success') {
            const images =
                pollJson?.data?.task_result?.images ??
                pollJson?.data?.task_result?.image ??
                pollJson?.data?.images ??
                [];
            const firstImage = Array.isArray(images) && images.length > 0
                ? images[0]
                : null;
            imageUrl = String(
                firstImage?.url ?? firstImage?.uri ?? '',
            ).trim();
            break;
        }

        if (status === 'failed') {
            const message =
                String(pollJson?.data?.task_status_msg ?? '').trim() ||
                String(pollJson?.message ?? '').trim() ||
                'Unknown Kling image failure';
            throw new InternalServerErrorException(
                `Kling image generation failed: ${message}`,
            );
        }

        await sleep(pollIntervalMs);
    }

    if (!imageUrl) {
        throw new InternalServerErrorException(
            'Timed out while waiting for Kling image generation to complete',
        );
    }

    const buffer = await downloadImageToBuffer(imageUrl, 'Kling');

    return {
        buffer,
        base64: buffer.toString('base64'),
    };
};