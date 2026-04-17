import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UploadsService } from '../uploads/uploads.service';
import { Overlay } from './entities/overlay.entity';

type OverlayUploadFile = {
  buffer: Buffer;
  originalname?: string;
  mimetype?: string;
};

@Injectable()
export class OverlaysService {
  constructor(
    @InjectRepository(Overlay)
    private readonly repo: Repository<Overlay>,
    private readonly uploadsService: UploadsService,
  ) {}

  private normalizeSettings(value: unknown): Record<string, unknown> {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return {};

      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return {};
      }

      return {};
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private async resolveUpload(params: {
    file?: OverlayUploadFile | null;
    sourceUrl?: string | null;
  }): Promise<{ url: string; providerRef: string | null; mimeType: string | null }> {
    if (params.file?.buffer?.length) {
      const upload = await this.uploadsService.uploadBuffer({
        buffer: params.file.buffer,
        filename: String(params.file.originalname ?? 'overlay.mp4').trim() || 'overlay.mp4',
        mimeType: params.file.mimetype ?? null,
        folder: 'auto-video-generator/overlays',
        resourceType: 'video',
      });

      return {
        url: upload.url,
        providerRef: upload.providerRef,
        mimeType: String(params.file.mimetype ?? '').trim() || null,
      };
    }

    const sourceUrl = String(params.sourceUrl ?? '').trim();
    if (!sourceUrl) {
      throw new BadRequestException('Overlay file or sourceUrl is required');
    }

    const ensured = await this.uploadsService.ensurePublicUrl({
      sourceUrl,
      folder: 'auto-video-generator/overlays',
      resourceType: 'video',
    });

    return {
      url: ensured.url,
      providerRef: ensured.providerRef,
      mimeType: null,
    };
  }

  async findAllByUser(
    user_id: string,
    page = 1,
    limit = 50,
    q?: string,
  ): Promise<{
    items: Overlay[];
    total: number;
    page: number;
    limit: number;
  }> {
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit =
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 50;
    const search = String(q ?? '')
      .trim()
      .toLowerCase();

    const qb = this.repo
      .createQueryBuilder('overlay')
      .where('overlay.user_id = :user_id', { user_id });

    if (search) {
      qb.andWhere('LOWER(overlay.title) LIKE :search', {
        search: `%${search}%`,
      });
    }

    const [items, total] = await qb
      .orderBy('overlay.updated_at', 'DESC')
      .addOrderBy('overlay.created_at', 'DESC')
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit)
      .getManyAndCount();

    return { items, total, page: safePage, limit: safeLimit };
  }

  async createForUser(params: {
    user_id: string;
    title: string;
    settings?: unknown;
    sourceUrl?: string | null;
    file?: OverlayUploadFile | null;
  }): Promise<Overlay> {
    const upload = await this.resolveUpload({
      file: params.file,
      sourceUrl: params.sourceUrl,
    });

    const entity = this.repo.create({
      user_id: params.user_id,
      title: String(params.title ?? '').trim(),
      url: upload.url,
      public_id: upload.providerRef,
      mime_type: upload.mimeType,
      settings: this.normalizeSettings(params.settings),
    });

    return this.repo.save(entity);
  }

  async updateById(params: {
    user_id: string;
    overlayId: string;
    title?: string;
    settings?: unknown;
    sourceUrl?: string | null;
    file?: OverlayUploadFile | null;
  }): Promise<Overlay> {
    const overlayId = String(params.overlayId ?? '').trim();
    if (!overlayId) {
      throw new NotFoundException('Overlay not found');
    }

    const target = await this.repo.findOne({
      where: { id: overlayId, user_id: params.user_id },
    });
    if (!target) {
      throw new NotFoundException('Overlay not found');
    }

    if (params.title !== undefined) {
      target.title = String(params.title ?? '').trim() || target.title;
    }
    if (params.settings !== undefined) {
      target.settings = this.normalizeSettings(params.settings);
    }

    if (params.file?.buffer?.length || String(params.sourceUrl ?? '').trim()) {
      const previousProviderRef = String(target.public_id ?? '').trim() || null;
      const upload = await this.resolveUpload({
        file: params.file,
        sourceUrl: params.sourceUrl,
      });

      target.url = upload.url;
      target.public_id = upload.providerRef;
      target.mime_type = upload.mimeType;

      if (
        previousProviderRef &&
        previousProviderRef !== upload.providerRef
      ) {
        try {
          await this.uploadsService.deleteByRef({
            providerRef: previousProviderRef,
            resourceType: 'video',
          });
        } catch (error) {
          console.error('Failed to delete previous overlay asset', {
            overlayId,
            previousProviderRef,
            error,
          });
        }
      }
    }

    return this.repo.save(target);
  }

  async deleteById(params: {
    user_id: string;
    overlayId: string;
  }): Promise<string> {
    const overlayId = String(params.overlayId ?? '').trim();
    if (!overlayId) {
      throw new NotFoundException('Overlay not found');
    }

    const target = await this.repo.findOne({
      where: { id: overlayId, user_id: params.user_id },
    });
    if (!target) {
      throw new NotFoundException('Overlay not found');
    }

    const providerRef = String(target.public_id ?? '').trim() || null;
    if (providerRef) {
      try {
        await this.uploadsService.deleteByRef({
          providerRef,
          resourceType: 'video',
        });
      } catch (error) {
        console.error('Failed to delete overlay asset', {
          overlayId,
          providerRef,
          error,
        });
      }
    }

    await this.repo.delete({ id: target.id, user_id: params.user_id } as any);
    return target.id;
  }
}