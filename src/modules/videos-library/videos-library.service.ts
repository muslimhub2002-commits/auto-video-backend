import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { Video, VideoSize } from '../videos/entities/video.entity';
import { downloadUrlToBuffer } from '../render-videos/utils/net.utils';
import {
  browsePexelsVideos,
  searchPexelsVideos,
} from '../../common/pexels/pexels.utils';
import {
  browsePixabayVideos,
  PixabayVideoFile,
  searchPixabayVideos,
} from '../../common/pixabay/pixabay.utils';
import * as fs from 'fs';
import * as os from 'os';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';

type FindVideoFilters = {
  query?: string;
  orientation?: string;
};

type FreestockVideoItem = {
  id: string;
  externalId: string;
  source: 'pexels' | 'pixabay';
  video: string;
  thumbnail: string | null;
  video_type: string | null;
  video_size: Video['video_size'] | null;
  duration: number | null;
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

const normalizeOrientation = (value: unknown): Video['video_size'] | null => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (normalized === VideoSize.PORTRAIT) return VideoSize.PORTRAIT;
  if (normalized === VideoSize.LANDSCAPE) return VideoSize.LANDSCAPE;
  return null;
};

const normalizePexelsOrientation = (value: unknown) => {
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

const matchesSquareishOrientation = (
  width?: number | null,
  height?: number | null,
) => {
  if (!width || !height) return false;
  const ratio = width / height;
  return ratio >= 0.9 && ratio <= 1.1;
};

const matchesRequestedVideoOrientation = (
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
    inferVideoOrientation(width, height) === normalizeOrientation(normalized)
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

const pickPixabayVideoFile = (videos?: {
  large?: PixabayVideoFile;
  medium?: PixabayVideoFile;
  small?: PixabayVideoFile;
  tiny?: PixabayVideoFile;
}) => {
  const files = [videos?.large, videos?.medium, videos?.small, videos?.tiny]
    .filter((item): item is PixabayVideoFile => Boolean(item?.url))
    .sort(
      (left, right) => (Number(right.width) || 0) - (Number(left.width) || 0),
    );

  return files[0] ?? null;
};

const inferVideoOrientation = (
  width?: number | null,
  height?: number | null,
) => {
  if (!width || !height) return null;
  return width >= height ? VideoSize.LANDSCAPE : VideoSize.PORTRAIT;
};

const inferVideoExtension = (url: string, mimeType?: string) => {
  const normalizedPath = (() => {
    try {
      return extname(new URL(url).pathname);
    } catch {
      return '';
    }
  })();

  if (normalizedPath) return normalizedPath;
  if (mimeType?.includes('webm')) return '.webm';
  if (mimeType?.includes('quicktime')) return '.mov';
  return '.mp4';
};

@Injectable()
export class VideosLibraryService {
  constructor(
    @InjectRepository(Video)
    private readonly videosRepository: Repository<Video>,
  ) {}

  async findAllByUser(
    user_id: string,
    page = 1,
    limit = 20,
    filters: FindVideoFilters = {},
  ): Promise<{ items: Video[]; total: number; page: number; limit: number }> {
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit =
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 50) : 20;

    const qb = this.videosRepository
      .createQueryBuilder('v')
      .where('v.user_id = :user_id', { user_id });

    const query = String(filters.query ?? '').trim();
    const orientation = normalizeOrientation(filters.orientation);

    if (query) {
      qb.andWhere("LOWER(COALESCE(v.video_type, '')) LIKE LOWER(:query)", {
        query: `%${query}%`,
      });
    }

    if (orientation) {
      qb.andWhere('v.video_size = :orientation', { orientation });
    }

    qb.orderBy('v.created_at', 'DESC')
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit);

    const [items, total] = await qb.getManyAndCount();

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
    items: FreestockVideoItem[];
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
        const items: FreestockVideoItem[] = [];
        let total = 0;

        for (
          let providerPage = page, fetchCount = 0;
          fetchCount < MAX_FREESTOCK_FETCH_PAGES && items.length < limit;
          providerPage += 1, fetchCount += 1
        ) {
          const response = query
            ? await searchPixabayVideos({
                query,
                page: providerPage,
                perPage: requestLimit,
              })
            : await browsePixabayVideos({
                page: providerPage,
                perPage: requestLimit,
              });

          total = Number(response.totalHits) || Number(response.total) || total;

          const batchItems = (response.hits ?? [])
            .map<FreestockVideoItem | null>((video) => {
              const selectedFile = pickPixabayVideoFile(video.videos);
              if (!selectedFile?.url) {
                return null;
              }

              const width = Number(selectedFile.width) || null;
              const height = Number(selectedFile.height) || null;
              if (
                !matchesRequestedVideoOrientation(
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
                id: `pixabay-video-${video.id}`,
                externalId: String(video.id),
                source: 'pixabay' as const,
                video: selectedFile.url,
                thumbnail: selectedFile.thumbnail?.trim() || null,
                video_type: video.tags?.trim() || query || null,
                video_size: inferVideoOrientation(width, height),
                duration: Number.isFinite(video.duration)
                  ? Number(video.duration)
                  : null,
                width,
                height,
                authorName: video.user?.trim() || null,
                authorUrl: buildPixabayAuthorUrl(
                  video.user,
                  Number(video.user_id) || null,
                ),
                pexelsUrl: null,
                pixabayUrl: video.pageURL?.trim() || null,
                downloadUrl: selectedFile.url,
              } satisfies FreestockVideoItem;
            })
            .filter((item): item is FreestockVideoItem => item !== null);

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

      const items: FreestockVideoItem[] = [];
      let total = 0;

      for (
        let providerPage = page, fetchCount = 0;
        fetchCount < MAX_FREESTOCK_FETCH_PAGES && items.length < limit;
        providerPage += 1, fetchCount += 1
      ) {
        const response = query
          ? await searchPexelsVideos({
              query,
              page: providerPage,
              perPage: requestLimit,
              orientation: normalizePexelsOrientation(params.orientation),
              size: normalizePexelsSize(params.size),
            })
          : await browsePexelsVideos({
              page: providerPage,
              perPage: requestLimit,
            });

        total = Number(response.total_results) || total;

        const batchItems = (response.videos ?? [])
          .map<FreestockVideoItem | null>((video) => {
            const sortedFiles = [...(video.video_files ?? [])].sort(
              (left, right) => {
                const leftWidth = Number(left.width) || 0;
                const rightWidth = Number(right.width) || 0;
                return rightWidth - leftWidth;
              },
            );
            const selectedFile =
              sortedFiles.find((item) => item.quality === 'hd' && item.link) ||
              sortedFiles.find((item) => item.link) ||
              null;

            if (!selectedFile?.link) {
              return null;
            }

            const width = Number.isFinite(video.width)
              ? Number(video.width)
              : Number(selectedFile.width) || null;
            const height = Number.isFinite(video.height)
              ? Number(video.height)
              : Number(selectedFile.height) || null;

            if (
              !matchesRequestedVideoOrientation(
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
              id: `pexels-video-${video.id}`,
              externalId: String(video.id),
              source: 'pexels' as const,
              video: selectedFile.link,
              thumbnail:
                video.image?.trim() ||
                video.video_pictures?.[0]?.picture?.trim() ||
                null,
              video_type: query || null,
              video_size: inferVideoOrientation(width, height),
              duration: Number.isFinite(video.duration)
                ? Number(video.duration)
                : null,
              width,
              height,
              authorName: video.user?.name?.trim() || null,
              authorUrl: video.user?.url?.trim() || null,
              pexelsUrl: video.url?.trim() || null,
              pixabayUrl: null,
              downloadUrl: selectedFile.link,
            } satisfies FreestockVideoItem;
          })
          .filter((item): item is FreestockVideoItem => item !== null);

        items.push(...batchItems.slice(0, limit - items.length));

        if ((response.videos ?? []).length < requestLimit) {
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
          `Failed to search ${provider === 'pixabay' ? 'Pixabay' : 'Pexels'} videos`,
      );
    }
  }

  async importFreestockVideo(
    user_id: string,
    body: {
      videoUrl?: string;
      downloadUrl?: string;
      video_type?: string;
      video_size?: Video['video_size'];
      width?: number;
      height?: number;
      source?: string;
    },
  ) {
    const sourceUrl = String(body.downloadUrl ?? body.videoUrl ?? '').trim();
    if (!sourceUrl) {
      throw new NotFoundException('Missing freestock video URL');
    }

    if (this.isServerlessRuntime()) {
      throw new ServiceUnavailableException(
        'Saving freestock videos requires persistent storage and is not supported on serverless runtimes.',
      );
    }

    const existing = await this.videosRepository.findOne({
      where: {
        user_id,
        video: sourceUrl,
      },
    });
    if (existing) return existing;

    const { buffer, mimeType } = await downloadUrlToBuffer({
      url: sourceUrl,
      maxBytes: 250 * 1024 * 1024,
      label: 'Pexels video',
    });

    const ext = inferVideoExtension(sourceUrl, mimeType);
    const fileName = `${randomUUID()}${ext}`;
    const relPath = join('sentence-videos', fileName);
    const absDir = join(this.getStorageRoot(), 'sentence-videos');
    this.ensureDir(absDir);
    fs.writeFileSync(join(this.getStorageRoot(), relPath), buffer);

    const saved = this.videosRepository.create({
      video: this.toStaticUrl(relPath),
      user_id,
      video_type:
        String(body.video_type ?? body.source ?? 'freestock').trim() ||
        'freestock',
      video_size:
        normalizeOrientation(body.video_size) ??
        inferVideoOrientation(
          Number(body.width) || null,
          Number(body.height) || null,
        ) ??
        null,
      width: Number.isFinite(Number(body.width)) ? Number(body.width) : null,
      height: Number.isFinite(Number(body.height)) ? Number(body.height) : null,
    } as Partial<Video>);

    return this.videosRepository.save(saved);
  }

  async deleteById(user_id: string, id: string, force = false) {
    const video = await this.videosRepository.findOne({
      where: { id, user_id },
    });

    if (!video) {
      throw new NotFoundException('Video not found');
    }

    const [{ count }] = await this.videosRepository.manager.query(
      `SELECT COUNT(*)::int AS count FROM sentences WHERE video_id = $1`,
      [id],
    );

    if (!force && Number(count) > 0) {
      throw new ConflictException({
        code: 'VIDEO_REFERENCED',
        message:
          'This video is referenced by one or more script sentences. Delete again to confirm.',
        referenceCount: Number(count),
      });
    }

    await this.videosRepository.remove(video);

    return {
      id,
      deleted: true,
      referenceCount: Number(count) || 0,
    };
  }

  private isServerlessRuntime() {
    return (
      String(process.env.VERCEL ?? '').trim() === '1' ||
      String(process.env.AWS_LAMBDA_FUNCTION_NAME ?? '').trim().length > 0
    );
  }

  private getStorageRoot() {
    if (this.isServerlessRuntime()) {
      return join(os.tmpdir(), 'auto-video-generator');
    }

    return join(process.cwd(), 'storage');
  }

  private ensureDir(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private toStaticUrl(relPath: string) {
    const baseUrl =
      process.env.REMOTION_ASSET_BASE_URL ??
      `http://127.0.0.1:${process.env.PORT ?? 3000}`;
    return `${baseUrl}/static/${relPath.replace(/\\/g, '/')}`;
  }
}
