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
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EnsurePublicUrlDto } from './dto/ensure-public-url.dto';
import { UploadFileDto } from './dto/upload-file.dto';
import { UploadsService } from './uploads.service';

@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('file')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 150 * 1024 * 1024 },
    }),
  )
  async uploadFile(
    @UploadedFile() file: any,
    @Body() body: UploadFileDto,
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    if (!user?.id) {
      throw new UnauthorizedException('User not found in request');
    }

    if (!file?.buffer) {
      throw new BadRequestException('No file uploaded');
    }

    return this.uploadsService.uploadBuffer({
      buffer: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype,
      folder: body.folder ?? 'auto-video-generator/uploads',
      resourceType: body.resourceType ?? 'image',
    });
  }

  @Post('ensure-public-url')
  async ensurePublicUrl(@Body() body: EnsurePublicUrlDto, @Req() req: Request) {
    const user = (req as any).user;
    if (!user?.id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.uploadsService.ensurePublicUrl({
      sourceUrl: body.url,
      filename: body.filename,
      folder: body.folder ?? 'auto-video-generator/uploads',
      resourceType: body.resourceType ?? 'video',
    });
  }
}
