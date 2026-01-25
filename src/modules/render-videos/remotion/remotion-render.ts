import { join } from 'path';
import * as os from 'os';

import {
  REMOTION_LAMBDA_FUNCTION_NAME,
  REMOTION_LAMBDA_REGION,
  REMOTION_LAMBDA_SERVE_URL,
} from './remotion.config';

const getPositiveIntOrNull = (value: unknown) => {
  const num = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.floor(num);
};

const normalizeAndValidateLambdaServeUrl = (raw: string) => {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    throw new Error(
      'Remotion Lambda is enabled but REMOTION_LAMBDA_SERVE_URL is not set. Deploy a Remotion site to S3 and set REMOTION_LAMBDA_SERVE_URL (or legacy REMOTION_LAMBDA_TEST_SERVE_URL).',
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(
      `Invalid REMOTION_LAMBDA_SERVE_URL: "${trimmed}". Expected an https URL to the Remotion site index.html on S3 (deploySite() output).`,
    );
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(
      `Invalid REMOTION_LAMBDA_SERVE_URL protocol: "${url.protocol}". Expected https (or http for local testing).`,
    );
  }

  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.vercel.app') ||
    host.includes('vercel.app')
  ) {
    throw new Error(
      `REMOTION_LAMBDA_SERVE_URL must point to a Remotion bundle hosted on S3 (or CloudFront), not "${url.hostname}". Use the exact site.serveUrl printed by the deploy script (usually .../sites/<siteName>/index.html).`,
    );
  }

  // For Remotion deploySite(), the serveUrl typically ends with /sites/<siteName>/index.html.
  // Normalize common mistakes like providing the directory instead of index.html.
  if (url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}index.html`;
  }

  if (!url.pathname.toLowerCase().endsWith('index.html')) {
    // If the user provided bucket root, this is almost certainly wrong.
    throw new Error(
      `REMOTION_LAMBDA_SERVE_URL must end with "index.html" (the Remotion site entry). Got path: "${url.pathname}". Use the exact site.serveUrl printed by the deploy script (deploySite()).`,
    );
  }

  if (!url.pathname.includes('/sites/')) {
    throw new Error(
      `REMOTION_LAMBDA_SERVE_URL does not look like a Remotion deploySite() URL (missing "/sites/"). Got: "${url.toString()}". Use the exact site.serveUrl printed by the deploy script.`,
    );
  }

  return url.toString();
};

let remotionServeUrlPromise: Promise<string> | null = null;
let remotionServeUrl: string | null = null;
let remotionServeUrlPublicDir: string | null = null;

const getOrCreateRemotionServeUrl = async (params: {
  bundler: any;
  entryPoint: string;
  publicDir: string;
}) => {
  if (remotionServeUrl && remotionServeUrlPublicDir === params.publicDir) {
    return remotionServeUrl;
  }

  if (remotionServeUrlPromise && remotionServeUrlPublicDir === params.publicDir) {
    return remotionServeUrlPromise;
  }

  remotionServeUrlPublicDir = params.publicDir;
  remotionServeUrlPromise = params.bundler
    .bundle({
      entryPoint: params.entryPoint,
      publicDir: params.publicDir,
    })
    .then((url: string) => {
      remotionServeUrl = url;
      return url;
    })
    .finally(() => {
      remotionServeUrlPromise = null;
    });

  return remotionServeUrlPromise;
};

export const renderWithRemotionLocal = async (params: {
  timeline: any;
  outputFsPath: string;
  publicDir: string;
}) => {
  const bundler: any = await import('@remotion/bundler');
  const renderer: any = await import('@remotion/renderer');

  const entryPoint = join(process.cwd(), 'remotion', 'src', 'index.tsx');

  const concurrencyRaw = Number(process.env.REMOTION_CONCURRENCY ?? '');
  const defaultConcurrency = Math.min(2, Math.max(1, os.cpus().length));
  const concurrency = Number.isFinite(concurrencyRaw) && concurrencyRaw > 0
    ? Math.max(1, Math.floor(concurrencyRaw))
    : defaultConcurrency;

  const chromiumOptions: any = {
    disableWebSecurity: true,
  };

  if (process.env.REMOTION_CHROMIUM_DISABLE_SANDBOX === 'true') {
    chromiumOptions.disableSandbox = true;
  }

  const serveUrl = await getOrCreateRemotionServeUrl({
    bundler,
    entryPoint,
    publicDir: params.publicDir,
  });

  const compositions = await renderer.getCompositions(serveUrl, {
    inputProps: { timeline: params.timeline },
    chromiumOptions,
  });

  const composition = compositions.find((c: any) => c.id === 'AutoVideo') ?? {
    id: 'AutoVideo',
    width: params.timeline.width,
    height: params.timeline.height,
    fps: params.timeline.fps,
    durationInFrames: params.timeline.durationInFrames,
  };

  await renderer.renderMedia({
    composition: {
      ...composition,
      width: params.timeline.width,
      height: params.timeline.height,
      fps: params.timeline.fps,
      durationInFrames: params.timeline.durationInFrames,
    },
    serveUrl,
    codec: 'h264',
    outputLocation: params.outputFsPath,
    inputProps: { timeline: params.timeline },
    chromiumOptions,
    // Preserve existing behavior (was hard-coded to 2 in service).
    concurrency: 2,
    timeoutInMilliseconds: 600_000,
  });

  // avoid unused variable warning if we later choose to pass computed concurrency
  void concurrency;
};

export const renderWithRemotionOnLambda = async (params: {
  jobId?: string;
  timeline: any;
  outputFsPath: string;
  onProgress?: () => Promise<void>;
}) => {
  const lambdaClient: any = await import('@remotion/lambda/client');
  const lambda: any = await import('@remotion/lambda');

  const region = REMOTION_LAMBDA_REGION;
  let functionName = REMOTION_LAMBDA_FUNCTION_NAME;
  const serveUrl = normalizeAndValidateLambdaServeUrl(REMOTION_LAMBDA_SERVE_URL);

  if (!functionName || functionName.trim().toLowerCase() === 'auto') {
    const functions = await lambdaClient.getFunctions({
      region,
      compatibleOnly: true,
    });

    const preferred = functions.find(
      (f: any) => f?.functionName === REMOTION_LAMBDA_FUNCTION_NAME,
    );

    functionName =
      preferred?.functionName ?? functions?.[0]?.functionName ?? REMOTION_LAMBDA_FUNCTION_NAME;
  }

  if (!functionName) {
    throw new Error(
      'Remotion Lambda is enabled but no function name was resolved. Set REMOTION_LAMBDA_FUNCTION_NAME (or set it to "auto" to pick the first compatible function).',
    );
  }

  // Allow tuning render sizing/timeouts via env vars (same names as deploy script).
  const envMemory =
    getPositiveIntOrNull(process.env.REMOTION_LAMBDA_MEMORY_MB) ??
    getPositiveIntOrNull(process.env.REMOTION_LAMBDA_TEST_MEMORY_MB);

  const envTimeout =
    getPositiveIntOrNull(process.env.REMOTION_LAMBDA_TIMEOUT_SECONDS) ??
    getPositiveIntOrNull(process.env.REMOTION_LAMBDA_TEST_TIMEOUT_SECONDS);

  const memorySizeInMb = envMemory ?? 10240;
  const timeoutInSeconds = envTimeout ?? 900;

  const start = await lambdaClient.renderMediaOnLambda({
    memorySizeInMb,
    timeoutInSeconds,
    region,
    functionName,
    serveUrl,
    composition: 'AutoVideo',
    codec: 'h264',
    privacy: 'public',
    inputProps: { timeline: params.timeline },
  });

  const renderId: string = start.renderId;
  const bucketName: string = start.bucketName;

  const pollEveryMsRaw = Number(process.env.REMOTION_LAMBDA_POLL_MS ?? '5000');
  const pollEveryMs = Number.isFinite(pollEveryMsRaw)
    ? Math.max(2000, Math.floor(pollEveryMsRaw))
    : 5000;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const progress = await lambdaClient.getRenderProgress({
      region,
      functionName,
      bucketName,
      renderId,
    });

    if (params.onProgress) {
      await params.onProgress().catch(() => undefined);
    }

    if (progress?.fatalErrorEncountered) {
      const first = Array.isArray(progress?.errors) ? progress.errors[0] : null;
      const message =
        (first as any)?.message ||
        (first as any)?.stack ||
        'Lambda render failed (fatalErrorEncountered=true)';
      throw new Error(message);
    }

    if (progress?.done) {
      break;
    }

    await new Promise((r) => setTimeout(r, pollEveryMs));
  }

  await lambda.downloadMedia({
    region,
    bucketName,
    renderId,
    outPath: params.outputFsPath,
  });
};
