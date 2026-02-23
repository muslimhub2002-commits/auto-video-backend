import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';

import { AppVercelModule } from '../src/app.vercel.module';

const server = express();
let isBootstrapped = false;
let bootstrapPromise: Promise<void> | null = null;

const allowedProdOrigins = new Set([
  'https://auto-video-frontend.vercel.app',
  // If you later add a custom domain, add it here as well.
]);

const isLocalhostOrigin = (origin: string) => {
  return (
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) ||
    /^https?:\/\/\[::1\](:\d+)?$/i.test(origin)
  );
};

const isVercelFrontendOrigin = (origin: string) => {
  if (allowedProdOrigins.has(origin)) return true;
  return /^https:\/\/auto-video-frontend(-[a-z0-9-]+)?\.vercel\.app$/i.test(
    origin,
  );
};

const isAllowedOrigin = (origin?: string) => {
  if (!origin) return true;
  if (isLocalhostOrigin(origin)) return true;
  if (isVercelFrontendOrigin(origin)) return true;
  return false;
};

const applyCors = (req: any, res: any) => {
  const origin = req?.headers?.origin as string | undefined;
  if (origin && isAllowedOrigin(origin)) {
    const requestedHeaders = req.headers[
      'access-control-request-headers'
    ] as string | undefined;

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader(
      'Access-Control-Allow-Headers',
      requestedHeaders ?? 'Content-Type, Authorization, Accept, Range',
    );
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Length, Content-Range, Accept-Ranges',
    );
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET,HEAD,POST,PUT,DELETE,PATCH,OPTIONS',
    );
  }
};

// Always apply CORS at the Express layer so even bootstrap failures
// return useful CORS headers (otherwise browsers surface it as a "CORS error").
server.use((req, res, next) => {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    return res.status(204).send();
  }
  return next();
});

async function bootstrap() {
  if (isBootstrapped) return;
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    const app = await NestFactory.create(AppVercelModule, new ExpressAdapter(server), {
      logger: ['error', 'warn', 'log'],
    });

    app.enableCors({
      origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) return callback(null, true);
        return callback(
          new Error(`Not allowed by CORS: ${origin ?? '(no origin)'}`),
          false,
        );
      },
      credentials: true,
      // Intentionally not hardcoding allowedHeaders to reduce preflight brittleness.
      exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges'],
    });

    await app.init();
    isBootstrapped = true;
  })().finally(() => {
    bootstrapPromise = null;
  });

  return bootstrapPromise;
}

export default async function handler(req: any, res: any) {
  try {
    await bootstrap();
    return (server as any)(req, res);
  } catch (err) {
    applyCors(req, res);
    // Log a structured error so it's visible in Vercel logs.
    console.error('Vercel handler bootstrap failed', err);
    return res.status(500).json({
      message: 'Server bootstrap failed',
    });
  }
}
