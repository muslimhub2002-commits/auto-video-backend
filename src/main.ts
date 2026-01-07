import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Enable validation globally
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Serve static assets (audio/images/videos) from /static/*
  app.useStaticAssets(join(process.cwd(), 'storage'), {
    prefix: '/static/',
  });

  // Enable CORS with proper configuration
  app.enableCors({
    origin: [
      'http://localhost:3001',
      'http://localhost:3000',
      'https://auto-video-frontend.vercel.app',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  await app.listen(process.env.PORT ?? 3000);
  console.log(
    `🚀 Backend server is running on: http://localhost:${process.env.PORT ?? 3000}`,
  );
  console.log('YouTube module enabled');
}
bootstrap();
