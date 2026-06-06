import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { Multer } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EnsurePublicUrlDto } from './dto/ensure-public-url.dto';
import { UploadFileDto } from './dto/upload-file.dto';
import { UploadsService } from './uploads.service';
import { UploadProviderName } from './uploads.types';

type AuthenticatedRequest = Request & {
  user?: {
    id?: string | null;
  };
};

@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  private parseExcludedProviders(
    rawValue: string | null | undefined,
  ): UploadProviderName[] {
    return String(rawValue ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(
        (item): item is UploadProviderName =>
          item === 'cloudinary' ||
          item === 'uploadcare' ||
          item === 'filestack' ||
          item === 'smash',
      );
  }

  @Post('file')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 150 * 1024 * 1024 },
    }),
  )
  async uploadFile(
    @UploadedFile() file: Multer.File | undefined,
    @Body() body: UploadFileDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const user = req.user;
    if (!user?.id) {
      throw new UnauthorizedException('User not found in request');
    }

    if (!file?.buffer) {
      throw new BadRequestException('No file uploaded');
    }

    const excludedProviders = this.parseExcludedProviders(
      body.excludedProviders,
    );

    return this.uploadsService.uploadBuffer({
      buffer: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype,
      folder: body.folder ?? 'auto-video-generator/uploads',
      resourceType: body.resourceType ?? 'image',
      ...(excludedProviders.length ? { excludedProviders } : {}),
    });
  }

  @Post('ensure-public-url')
  async ensurePublicUrl(
    @Body() body: EnsurePublicUrlDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const user = req.user;
    if (!user?.id) {
      throw new UnauthorizedException('User not found in request');
    }

    const excludedProviders = this.parseExcludedProviders(
      body.excludedProviders,
    );

    return this.uploadsService.ensurePublicUrl({
      sourceUrl: body.url,
      filename: body.filename,
      folder: body.folder ?? 'auto-video-generator/uploads',
      resourceType: body.resourceType ?? 'video',
      ...(excludedProviders.length ? { excludedProviders } : {}),
    });
  }
}
