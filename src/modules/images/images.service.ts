import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { Image } from './entities/image.entity';
import { CreateImageDto } from './dto/create-image.dto';
import { UpdateImageDto } from './dto/update-image.dto';
import tinify from 'tinify';
import * as crypto from 'crypto';
import { downloadUrlToBuffer } from '../render-videos/utils/net.utils';
import { UploadsService } from '../uploads/uploads.service';
import {
  browsePexelsPhotos,
  searchPexelsPhotos,
} from '../../common/pexels/pexels.utils';
import {
  browsePixabayImages,
  searchPixabayImages,
} from '../../common/pixabay/pixabay.utils';

type FindImagesFilters = {
  query?: string;
  orientation?: string;
};

type FreestockImageItem = {
  id: string;
  externalId: string;
  source: 'pexels' | 'pixabay';
  image: string;
  thumbnail: string;
  prompt: string | null;
  image_style: string | null;
  image_size: Image['image_size'] | null;
  color: string | null;
  width: number | null;
  height: number | null;
  authorName: string | null;
  authorUrl: string | null;
  pexelsUrl: string | null;
  pixabayUrl: string | null;
  downloadUrl: string;
};

type FreestockProvider = 'pexels' | 'pixabay';

const MAX_FREESTOCK_FETCH_PAGES = 4;

const getFreestockFetchPageSize = (limit: number) => {
  const safeLimit = Math.max(1, limit);
  return Math.min(50, Math.max(safeLimit, safeLimit * 2));
};

const normalizeOrientation = (value: unknown): Image['image_size'] | null => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'portrait') return 'portrait' as Image['image_size'];
  if (normalized === 'landscape') return 'landscape' as Image['image_size'];
  return null;
};

const normalizePexelsSearchOrientation = (value: unknown) => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (
    normalized === 'portrait' ||
    normalized === 'landscape' ||
    normalized === 'square'
  ) {
    return normalized;
  }
  return null;
};

const normalizePexelsSize = (value: unknown) => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (
    normalized === 'small' ||
    normalized === 'medium' ||
    normalized === 'large'
  ) {
    return normalized;
  }
  return null;
};

const normalizePixabayOrientation = (value: unknown) => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'landscape') return 'horizontal';
  if (normalized === 'portrait') return 'vertical';
  return null;
};

const normalizePixabayColor = (value: unknown) => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return null;

  const allowedColors = new Set([
    'grayscale',
    'transparent',
    'red',
    'orange',
    'yellow',
    'green',
    'turquoise',
    'blue',
    'lilac',
    'pink',
    'white',
    'gray',
    'black',
    'brown',
  ]);

  return allowedColors.has(normalized) ? normalized : null;
};

const matchesSquareishOrientation = (
  width?: number | null,
  height?: number | null,
) => {
  if (!width || !height) return false;
  const ratio = width / height;
  return ratio >= 0.9 && ratio <= 1.1;
};

const matchesRequestedImageOrientation = (
  requested: unknown,
  width?: number | null,
  height?: number | null,
) => {
  const normalized = String(requested ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return true;
  if (normalized === 'square') {
    return matchesSquareishOrientation(width, height);
  }

  return (
    inferImageOrientation(width, height) === normalizeOrientation(normalized)
  );
};

const matchesRequestedSize = (
  requested: unknown,
  width?: number | null,
  height?: number | null,
) => {
  const normalized = String(requested ?? '')
    .trim()
    .toLowerCase();
  if (!normalized || !width || !height) return true;

  const largestDimension = Math.max(width, height);
  if (normalized === 'small') return largestDimension < 1000;
  if (normalized === 'medium')
    return largestDimension >= 1000 && largestDimension < 2000;
  if (normalized === 'large') return largestDimension >= 2000;
  return true;
};

const buildPixabayAuthorUrl = (
  username?: string | null,
  userId?: number | null,
) => {
  const normalizedUsername = String(username ?? '').trim();
  if (!normalizedUsername || !userId) return null;
  return `https://pixabay.com/users/${normalizedUsername}-${userId}/`;
};

const inferImageOrientation = (
  width?: number | null,
  height?: number | null,
) => {
  if (!width || !height) return null;
  return width >= height
    ? ('landscape' as Image['image_size'])
    : ('portrait' as Image['image_size']);
};

@Injectable()
export class ImagesService {
  constructor(
    @InjectRepository(Image)
    private readonly imagesRepository: Repository<Image>,
    private readonly uploadsService: UploadsService,
  ) {
    if (process.env.TINIFY_KEY) {
      tinify.key = process.env.TINIFY_KEY;
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
    filters: FindImagesFilters = {},
  ): Promise<{ items: Image[]; total: number; page: number; limit: number }> {
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit =
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 50) : 20;

    const where: Record<string, unknown> = { user_id };
    const query = String(filters.query ?? '').trim();
    const orientation = normalizeOrientation(filters.orientation);

    if (query) {
      where.prompt = ILike(`%${query}%`);
    }

    if (orientation) {
      where.image_size = orientation;
    }

    const [items, total] = await this.imagesRepository.findAndCount({
      where,
      order: { created_at: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return { items, total, page: safePage, limit: safeLimit };
  }

  async searchFreestock(params: {
    page?: number;
    limit?: number;
    query?: string;
    orientation?: string;
    size?: string;
    color?: string;
    provider?: FreestockProvider;
  }): Promise<{
    items: FreestockImageItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    const query = String(params.query ?? '').trim();
    const provider = params.provider ?? 'pexels';

    try {
      const page = Math.max(1, Number(params.page) || 1);
      const limit = Math.min(50, Math.max(1, Number(params.limit) || 20));
      const requestLimit = getFreestockFetchPageSize(limit);
      if (provider === 'pixabay') {
        const items: FreestockImageItem[] = [];
        let total = 0;

        for (
          let providerPage = page, fetchCount = 0;
          fetchCount < MAX_FREESTOCK_FETCH_PAGES && items.length < limit;
          providerPage += 1, fetchCount += 1
        ) {
          const response = query
            ? await searchPixabayImages({
                query,
                page: providerPage,
                perPage: requestLimit,
                orientation: normalizePixabayOrientation(params.orientation),
                colors: normalizePixabayColor(params.color),
              })
            : await browsePixabayImages({
                page: providerPage,
                perPage: requestLimit,
                orientation: normalizePixabayOrientation(params.orientation),
                colors: normalizePixabayColor(params.color),
              });

          total = Number(response.totalHits) || Number(response.total) || total;

          const batchItems = (response.hits ?? [])
            .map<FreestockImageItem | null>((image) => {
              const width =
                Number(image.imageWidth) ||
                Number(image.webformatWidth) ||
                null;
              const height =
                Number(image.imageHeight) ||
                Number(image.webformatHeight) ||
                null;
              if (
                !matchesRequestedImageOrientation(
                  params.orientation,
                  width,
                  height,
                )
              ) {
                return null;
              }
              if (!matchesRequestedSize(params.size, width, height)) {
                return null;
              }

              const downloadUrl =
                image.largeImageURL?.trim() ||
                image.webformatURL?.trim() ||
                image.previewURL?.trim() ||
                '';

              if (!downloadUrl) {
                return null;
              }

              return {
                id: `pixabay-image-${image.id}`,
                externalId: String(image.id),
                source: 'pixabay',
                image: downloadUrl,
                thumbnail:
                  image.previewURL?.trim() ||
                  image.webformatURL?.trim() ||
                  downloadUrl,
                prompt: image.tags?.trim() || null,
                image_style: null,
                image_size: inferImageOrientation(width, height),
                color: null,
                width,
                height,
                authorName: image.user?.trim() || null,
                authorUrl: buildPixabayAuthorUrl(
                  image.user,
                  Number(image.user_id) || null,
                ),
                pexelsUrl: null,
                pixabayUrl: image.pageURL?.trim() || null,
                downloadUrl,
              } satisfies FreestockImageItem;
            })
            .filter((item): item is FreestockImageItem => item !== null);

          items.push(...batchItems.slice(0, limit - items.length));

          if ((response.hits ?? []).length < requestLimit) {
            break;
          }
        }

        return {
          items,
          total: total || items.length,
          page,
          limit,
        };
      }

      const items: FreestockImageItem[] = [];
      let total = 0;

      for (
        let providerPage = page, fetchCount = 0;
        fetchCount < MAX_FREESTOCK_FETCH_PAGES && items.length < limit;
        providerPage += 1, fetchCount += 1
      ) {
        const response = query
          ? await searchPexelsPhotos({
              query,
              page: providerPage,
              perPage: requestLimit,
              orientation: normalizePexelsSearchOrientation(params.orientation),
              size: normalizePexelsSize(params.size),
              color: String(params.color ?? '').trim() || null,
            })
          : await browsePexelsPhotos({
              page: providerPage,
              perPage: requestLimit,
            });

        total = Number(response.total_results) || total;

        const batchItems = (response.photos ?? [])
          .map<FreestockImageItem | null>((photo) => {
            const downloadUrl =
              photo.src?.large2x ||
              photo.src?.large ||
              photo.src?.portrait ||
              photo.src?.landscape ||
              photo.src?.original ||
              '';

            if (!downloadUrl) {
              return null;
            }

            const width = Number.isFinite(photo.width) ? photo.width : null;
            const height = Number.isFinite(photo.height) ? photo.height : null;
            if (
              !matchesRequestedImageOrientation(
                params.orientation,
                width,
                height,
              )
            ) {
              return null;
            }
            if (!matchesRequestedSize(params.size, width, height)) {
              return null;
            }

            return {
              id: `pexels-photo-${photo.id}`,
              externalId: String(photo.id),
              source: 'pexels',
              image: downloadUrl,
              thumbnail:
                photo.src?.medium ||
                photo.src?.small ||
                photo.src?.tiny ||
                downloadUrl,
              prompt: photo.alt?.trim() || null,
              image_style: null,
              image_size: inferImageOrientation(width, height),
              color: photo.avg_color ?? null,
              width,
              height,
              authorName: photo.photographer?.trim() || null,
              authorUrl: photo.photographer_url?.trim() || null,
              pexelsUrl: photo.url?.trim() || null,
              pixabayUrl: null,
              downloadUrl,
            } satisfies FreestockImageItem;
          })
          .filter((item): item is FreestockImageItem => item !== null);

        items.push(...batchItems.slice(0, limit - items.length));

        if ((response.photos ?? []).length < requestLimit) {
          break;
        }
      }

      return {
        items,
        total: total || items.length,
        page,
        limit,
      };
    } catch (error: any) {
      const message = String(error?.message ?? '').trim();
      if (/PEXELS_API_KEY|PIXABAY_API_KEY/i.test(message)) {
        throw new ServiceUnavailableException(message);
      }
      throw new InternalServerErrorException(
        message ||
          `Failed to search ${provider === 'pixabay' ? 'Pixabay' : 'Pexels'} images`,
      );
    }
  }

  async saveCompressedToCloudinary(params: {
    buffer: Buffer;
    filename: string;
    user_id: string;
    message_id?: string;
    image_style?: string;
    image_size?: Image['image_size'];
    image_quality?: Image['image_quality'];
    prompt?: string;
  }): Promise<Image> {
    if (!process.env.TINIFY_KEY) {
      throw new InternalServerErrorException('TINIFY_KEY is not configured');
    }

    try {
      // const source = tinify.fromBuffer(params.buffer);
      // const compressedBuffer = await source.toBuffer();

      // Compute a content hash of the compressed image to detect duplicates.
      const hash = crypto
        .createHash('sha256')
        .update(params.buffer)
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
        if (typeof params.prompt === 'string' && params.prompt.trim()) {
          existing.prompt = params.prompt.trim();
        }
        return this.imagesRepository.save(existing);
      }

      const uploadResult = await this.uploadsService.uploadBuffer({
        buffer: params.buffer,
        filename: params.filename,
        mimeType: null,
        folder: 'auto-video-generator/images',
        resourceType: 'image',
      });

      const imagePartial: Partial<Image> = {
        image: uploadResult.url,
        prompt: typeof params.prompt === 'string' ? params.prompt.trim() : null,
        user_id: params.user_id,
        message_id: params.message_id ?? null,
        image_style: params.image_style,
        image_size: params.image_size,
        image_quality: params.image_quality,
        public_id: uploadResult.providerRef,
        number_of_times_used: 0,
        hash,
      };

      const imageEntity = this.imagesRepository.create(imagePartial);

      return await this.imagesRepository.save(imageEntity);
    } catch (error: any) {
      const status =
        Number(error?.status ?? error?.statusCode ?? error?.code) || null;
      const message = String(error?.message ?? '').trim();

      // Tinify only supports PNG/JPG. Some providers (e.g. ModelsLab) may return WebP.
      // In that case, fall back to uploading the original buffer without compression.
      if (
        status === 415 ||
        /file type is not supported/i.test(message) ||
        /unsupported media type/i.test(message) ||
        /invalid image file/i.test(message)
      ) {
        console.warn(
          'Tinify rejected image (unsupported type). Uploading the original image through managed uploads.',
          { status: status ?? undefined, message: message || undefined },
        );

        return this.saveToCloudinary({
          buffer: params.buffer,
          filename: params.filename,
          user_id: params.user_id,
          message_id: params.message_id,
          image_style: params.image_style,
          image_size: params.image_size,
          image_quality: params.image_quality,
          prompt: params.prompt,
        });
      }

      console.error('Error in saveCompressedToCloudinary:', error);
      throw new InternalServerErrorException(
        message || 'Failed to compress and upload image',
      );
    }
  }

  async saveToCloudinary(params: {
    buffer: Buffer;
    filename: string;
    user_id: string;
    message_id?: string;
    image_style?: string;
    image_size?: Image['image_size'];
    image_quality?: Image['image_quality'];
    prompt?: string;
  }): Promise<Image> {
    try {
      const hash = crypto
        .createHash('sha256')
        .update(params.buffer)
        .digest('hex');

      const existing = await this.imagesRepository.findOne({
        where: {
          user_id: params.user_id,
          hash,
        },
      });

      if (existing) {
        existing.number_of_times_used += 1;
        if (typeof params.prompt === 'string' && params.prompt.trim()) {
          existing.prompt = params.prompt.trim();
        }
        return this.imagesRepository.save(existing);
      }

      const uploadResult = await this.uploadsService.uploadBuffer({
        buffer: params.buffer,
        filename: params.filename,
        mimeType: null,
        folder: 'auto-video-generator/images',
        resourceType: 'image',
      });

      const imagePartial: Partial<Image> = {
        image: uploadResult.url,
        prompt: typeof params.prompt === 'string' ? params.prompt.trim() : null,
        user_id: params.user_id,
        message_id: params.message_id ?? null,
        image_style: params.image_style,
        image_size: params.image_size,
        image_quality: params.image_quality,
        public_id: uploadResult.providerRef,
        number_of_times_used: 0,
        hash,
      };

      const imageEntity = this.imagesRepository.create(imagePartial);
      return await this.imagesRepository.save(imageEntity);
    } catch (error: any) {
      console.error('Error in saveToCloudinary:', error);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to upload image',
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

  async importFreestockImage(
    user_id: string,
    body: {
      imageUrl?: string;
      downloadUrl?: string;
      prompt?: string;
      image_style?: string;
      image_size?: Image['image_size'];
      color?: string;
      source?: string;
    },
  ): Promise<Image> {
    const sourceUrl = String(body.downloadUrl ?? body.imageUrl ?? '').trim();
    if (!sourceUrl) {
      throw new NotFoundException('Missing freestock image URL');
    }

    const { buffer } = await downloadUrlToBuffer({
      url: sourceUrl,
      maxBytes: 25 * 1024 * 1024,
      label: 'Pexels image',
    });

    const inferredSize = normalizeOrientation(body.image_size);
    const sourceLabel =
      String(body.source ?? 'freestock')
        .trim()
        .toLowerCase() || 'freestock';
    const filename = `${sourceLabel}-${crypto.randomUUID()}.jpg`;

    return this.saveCompressedToCloudinary({
      buffer,
      filename,
      user_id,
      prompt: body.prompt,
      image_style: body.image_style ?? body.color ?? undefined,
      image_size: inferredSize ?? undefined,
    });
  }

  async deleteById(user_id: string, id: string, force = false) {
    const image = await this.imagesRepository.findOne({
      where: { id, user_id },
    });

    if (!image) {
      throw new NotFoundException('Image not found');
    }

    const [{ count }] = await this.imagesRepository.manager.query(
      `
        SELECT COUNT(*)::int AS count
        FROM sentences
        WHERE image_id = $1 OR start_frame_image_id = $1 OR end_frame_image_id = $1
      `,
      [id],
    );

    if (!force && Number(count) > 0) {
      throw new ConflictException({
        code: 'IMAGE_REFERENCED',
        message:
          'This image is referenced by one or more script sentences. Delete again to confirm.',
        referenceCount: Number(count),
      });
    }

    if (image.public_id) {
      try {
        await this.uploadsService.deleteByRef({
          providerRef: image.public_id,
          resourceType: 'image',
        });
      } catch (error) {
        console.warn('Failed to delete image from managed uploads:', error);
      }
    }

    await this.imagesRepository.remove(image);

    return {
      id,
      deleted: true,
      referenceCount: Number(count) || 0,
    };
  }
}
