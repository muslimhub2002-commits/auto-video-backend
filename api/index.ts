import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';

import { AppModule } from '../src/app.module';

const server = express();
let isBootstrapped = false;
let bootstrapPromise: Promise<void> | null = null;

async function bootstrap() {
  if (isBootstrapped) return;
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
      logger: ['error', 'warn', 'log'],
    });

    // Keep CORS permissive for local `vercel dev` unless you lock it down via env.
    app.enableCors({
      origin: true,
      credentials: true,
    });

    await app.init();
    isBootstrapped = true;
  })().finally(() => {
    bootstrapPromise = null;
  });

  return bootstrapPromise;
}

export default async function handler(req: any, res: any) {
  await bootstrap();
  return (server as any)(req, res);
}
