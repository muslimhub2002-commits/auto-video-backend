import { Global, Module } from '@nestjs/common';
import { UploadcareUploadProvider } from './providers/uploadcare-upload.provider';
import { CloudinaryUploadProvider } from './providers/cloudinary-upload.provider';
import { FilestackUploadProvider } from './providers/filestack-upload.provider';
import { SmashUploadProvider } from './providers/smash-upload.provider';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Global()
@Module({
  providers: [
    CloudinaryUploadProvider,
    UploadcareUploadProvider,
    FilestackUploadProvider,
    SmashUploadProvider,
    UploadsService,
  ],
  controllers: [UploadsController],
  exports: [UploadsService],
})
export class UploadsModule {}
