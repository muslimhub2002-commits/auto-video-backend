import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Image } from './entities/image.entity';
import { CreateImageDto } from './dto/create-image.dto';
import { UpdateImageDto } from './dto/update-image.dto';
import tinify from 'tinify';
import { v2 as cloudinary } from 'cloudinary';
import * as crypto from 'crypto';

@Injectable()
export class ImagesService {
  constructor(
    @InjectRepository(Image)
    private readonly imagesRepository: Repository<Image>,
  ) {
    if (process.env.TINIFY_KEY) {
      tinify.key = process.env.TINIFY_KEY;
    }

    if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_CLOUD_SECRET) {
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_CLOUD_SECRET,
      });
    }
  }

  async create(createImageDto: CreateImageDto): Promise<Image> {
    const image = this.imagesRepository.create(createImageDto);
    return this.imagesRepository.save(image);
  }

  async findAllByUser(
    user_id: string,
    page = 1,
    limit = 20,
  ): Promise<{ items: Image[]; total: number; page: number; limit: number }> {
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 50) : 20;

    const [items, total] = await this.imagesRepository.findAndCount({
      where: { user_id },
      order: { created_at: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return { items, total, page: safePage, limit: safeLimit };
  }

  async saveCompressedToCloudinary(params: {
    buffer: Buffer;
    filename: string;
    user_id: string;
    message_id?: string;
    image_style?: string;
    image_size?: Image['image_size'];
    image_quality?: Image['image_quality'];
  }): Promise<Image> {
    if (!process.env.TINIFY_KEY) {
      throw new InternalServerErrorException('TINIFY_KEY is not configured');
    }

    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_CLOUD_SECRET) {
      throw new InternalServerErrorException('Cloudinary environment variables are not configured');
    }

    try {
      const source = tinify.fromBuffer(params.buffer);
      const compressedBuffer = await source.toBuffer();

      // Compute a content hash of the compressed image to detect duplicates.
      const hash = crypto
        .createHash('sha256')
        .update(compressedBuffer)
        .digest('hex');

      // If an image with the same hash already exists for this user,
      // reuse it instead of uploading a duplicate and creating a new row.
      const existing = await this.imagesRepository.findOne({
        where: {
          user_id: params.user_id,
          hash,
        },
      });

      if (existing) {
        // Optionally increment usage count to reflect reuse.
        existing.number_of_times_used += 1;
        return this.imagesRepository.save(existing);
      }

      const uploadResult: any = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'auto-video-generator/images',
            resource_type: 'image',
            overwrite: false,
          },
          (error, result) => {
            if (error || !result) {
              return reject(error ?? new Error('Cloudinary upload failed'));
            }
            resolve(result);
          },
        );

        stream.end(compressedBuffer);
      });

      const imagePartial: Partial<Image> = {
        image: uploadResult.secure_url,
        user_id: params.user_id,
        message_id: params.message_id ?? null,
        image_style: params.image_style,
        image_size: params.image_size,
        image_quality: params.image_quality,
        public_id: uploadResult.public_id,
        number_of_times_used: 0,
        hash,
      };

      const imageEntity = this.imagesRepository.create(imagePartial);

      return await this.imagesRepository.save(imageEntity);
    } catch (error: any) {
      // Log underlying error for debugging while returning a safe message
      // eslint-disable-next-line no-console
      console.error('Error in saveCompressedToCloudinary:', error);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to compress and upload image',
      );
    }
  }

  async update(id: string, updateImageDto: UpdateImageDto): Promise<Image> {
    await this.imagesRepository.update(id, updateImageDto);
    const updated = await this.imagesRepository.findOne({ where: { id } });
    if (!updated) {
      throw new InternalServerErrorException('Image not found after update');
    }
    return updated;
  }
}
