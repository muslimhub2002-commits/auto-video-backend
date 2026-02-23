import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Allow larger request bodies (e.g., longer scripts/sentence payloads).
  // Keep this reasonably bounded; uploads should still use multipart endpoints.
  app.use(json({ limit: process.env.BODY_SIZE_LIMIT ?? '400mb' }));
  app.use(
    urlencoded({
      extended: true,
      limit: process.env.BODY_SIZE_LIMIT ?? '400mb',
    }),
  );

  // Enable validation globally
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Enable CORS early so it also applies to static assets.
  // (If static assets are registered before CORS middleware, browsers may block
  // cross-origin downloads of /static/videos/*.mp4 and the YouTube Cloudinary step can appear to "hang".)
  const allowedProdOrigins = new Set([
    'https://auto-video-frontend.vercel.app',
    // If you later add a custom domain, add it here as well.
  ]);

  const isLocalhostOrigin = (origin: string) => {
    // Allow any localhost URL (any port, http or https), including 127.0.0.1 and IPv6 loopback.
    return (
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) ||
      /^https?:\/\/\[::1\](:\d+)?$/i.test(origin)
    );
  };

  const isVercelFrontendOrigin = (origin: string) => {
    // Allow the main production domain and Vercel preview deployments.
    // Preview domains look like: https://auto-video-frontend-git-branch-user.vercel.app
    if (allowedProdOrigins.has(origin)) return true;
    return /^https:\/\/auto-video-frontend(-[a-z0-9-]+)?\.vercel\.app$/i.test(
      origin,
    );
  };

  const isAllowedOrigin = (origin?: string) => {
    // Requests from tools like curl/postman often don't send an Origin header.
    if (!origin) return true;
    if (isLocalhostOrigin(origin)) return true;
    if (isVercelFrontendOrigin(origin)) return true;
    return false;
  };

  // Static assets (audio/images/videos) from /static/*
  // Ensure range requests + CORS work for browser fetch() + blob/arrayBuffer.
  app.use('/static', (req, res, next) => {
    const origin = req.headers.origin as string | undefined;
    const requestedHeaders = req.headers[
      'access-control-request-headers'
    ] as string | undefined;
    if (origin && isAllowedOrigin(origin)) {
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
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
    }

    if (req.method === 'OPTIONS') {
      return res.status(204).send();
    }

    return next();
  });

  app.enableCors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) return callback(null, true);
      return callback(new Error(`Not allowed by CORS: ${origin ?? '(no origin)'}`), false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
    // Don't hardcode allowed headers; reflect what's requested so browser preflights don't fail
    // when additional headers are introduced (e.g., by auth libs, proxies, or fetch wrappers).
    exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges'],
  });

  app.useStaticAssets(join(process.cwd(), 'storage'), {
    prefix: '/static/',
  });

  await app.listen(process.env.PORT ?? 3000);
  console.log(
    `🚀 Backend server is running on: http://localhost:${process.env.PORT ?? 3000}`,
  );
}
bootstrap();
