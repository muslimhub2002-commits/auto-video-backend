import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Script } from './entities/script.entity';
import { Sentence } from './entities/sentence.entity';
import { CreateScriptDto } from './dto/create-script.dto';
import { UpdateScriptDto } from './dto/update-script.dto';
import { AiService } from '../ai/ai.service';
import { Image } from '../images/entities/image.entity';
import {
  Video as VideoEntity,
  VideoSize,
} from '../videos/entities/video.entity';
import { UpdateSentenceMediaDto } from './dto/update-sentence-media.dto';
import { GenerateSentenceVideoDto } from './dto/generate-sentence-video.dto';
import { SaveSentenceVideoDto } from './dto/save-sentence-video.dto';
import { uploadBufferToCloudinary } from '../render-videos/utils/cloudinary.utils';

type UploadedImageFile = {
  buffer: Buffer;
  mimetype?: string;
  originalname?: string;
  size?: number;
};

type UploadedVideoFile = {
  buffer: Buffer;
  mimetype?: string;
  originalname?: string;
  size?: number;
};

@Injectable()
export class ScriptsService {
  constructor(
    @InjectRepository(Script)
    private readonly scriptRepository: Repository<Script>,
    @InjectRepository(Sentence)
    private readonly sentenceRepository: Repository<Sentence>,
    @InjectRepository(Image)
    private readonly imageRepository: Repository<Image>,
    @InjectRepository(VideoEntity)
    private readonly videoRepository: Repository<VideoEntity>,
    private readonly aiService: AiService,
  ) {}

  private async downloadUrlToBuffer(params: {
    url: string;
    maxBytes: number;
    label: string;
  }): Promise<{ buffer: Buffer; mimeType: string }> {
    const urlString = String(params.url ?? '').trim();
    if (!urlString) {
      throw new BadRequestException(`Missing URL for ${params.label}`);
    }

    let res: Response;
    try {
      res = await fetch(urlString, { redirect: 'follow' } as any);
    } catch (e) {
      const details = e instanceof Error ? e.message : String(e);
      throw new InternalServerErrorException(
        `Failed to download ${params.label}. Details: ${details}`,
      );
    }

    if (!res.ok) {
      throw new InternalServerErrorException(
        `Failed to download ${params.label} (status ${res.status})`,
      );
    }

    const mimeType =
      res.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > params.maxBytes) {
      throw new BadRequestException(
        `${params.label} is too large (${arrayBuffer.byteLength} bytes)`,
      );
    }

    return { buffer: Buffer.from(arrayBuffer), mimeType };
  }

  private assertHttpUrl(raw: string, label: string): string {
    const s = String(raw ?? '').trim();
    if (!s) {
      throw new BadRequestException(`${label} is required`);
    }
    let parsed: URL;
    try {
      parsed = new URL(s);
    } catch {
      throw new BadRequestException(`${label} must be a valid absolute URL`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException(`${label} must use http or https`);
    }
    return s;
  }

  async saveSentenceVideo(
    scriptId: string,
    sentenceId: string,
    userId: string,
    dto: SaveSentenceVideoDto,
    files?: { videoFile?: UploadedVideoFile },
  ): Promise<{ id: string; video: string }> {
    const script = await this.scriptRepository.findOne({
      where: { id: scriptId, user_id: userId },
      select: { id: true },
    });

    if (!script) {
      throw new NotFoundException('Script not found');
    }

    const sentence = await this.sentenceRepository.findOne({
      where: { id: sentenceId, script_id: scriptId },
      select: { id: true, script_id: true },
    });

    if (!sentence) {
      throw new NotFoundException('Sentence not found');
    }

    const file = files?.videoFile;
    const hasUploadedFile = Boolean(file?.buffer && file.buffer.length > 0);

    let finalVideoUrl: string;

    if (hasUploadedFile) {
      const mimeType =
        String(file?.mimetype ?? '').trim() || 'application/octet-stream';
      if (!mimeType.startsWith('video/')) {
        throw new BadRequestException('Video file must be a video');
      }

      const uploaded = await uploadBufferToCloudinary({
        buffer: file!.buffer,
        folder: 'auto-video-generator/sentence-videos',
        resource_type: 'video',
      });

      finalVideoUrl = uploaded.secure_url;
    } else {
      finalVideoUrl = this.assertHttpUrl(dto?.videoUrl ?? '', 'videoUrl');
    }

    // Column length is 255; keep a safety cap.
    if (finalVideoUrl.length > 255) {
      throw new BadRequestException('Video URL is too long');
    }

    const videoEntity = this.videoRepository.create({
      video: finalVideoUrl,
      user_id: userId,
      video_type: (dto?.video_type ?? 'gemini').trim() || 'gemini',
      video_size: dto?.video_size ?? VideoSize.PORTRAIT,
    });
    const saved = await this.videoRepository.save(videoEntity);

    await this.sentenceRepository.update(
      { id: sentenceId, script_id: scriptId },
      { video_id: saved.id },
    );

    return { id: saved.id, video: saved.video };
  }

  async generateSentenceVideoFromFrames(
    scriptId: string,
    sentenceId: string,
    userId: string,
    dto: GenerateSentenceVideoDto,
    files?: {
      startFrameFile?: UploadedImageFile;
      endFrameFile?: UploadedImageFile;
    },
  ): Promise<Script> {
    const script = await this.scriptRepository.findOne({
      where: { id: scriptId, user_id: userId },
      select: { id: true },
    });

    if (!script) {
      throw new NotFoundException('Script not found');
    }

    const sentence = await this.sentenceRepository.findOne({
      where: { id: sentenceId, script_id: scriptId },
      relations: {
        startFrameImage: true,
        endFrameImage: true,
      },
    });

    if (!sentence) {
      throw new NotFoundException('Sentence not found');
    }

    const isLooping = Boolean(dto?.isLooping);

    const prompt = (dto?.prompt ?? sentence.text ?? '').trim();
    if (!prompt) {
      throw new BadRequestException('Prompt is required');
    }

    const fromUploadedImage = (
      file: UploadedImageFile | undefined,
      label: string,
    ): { buffer: Buffer; mimeType: string } | null => {
      if (!file) return null;
      const mimeType =
        String(file.mimetype ?? '').trim() || 'application/octet-stream';
      if (!mimeType.startsWith('image/')) {
        throw new BadRequestException(`${label} must be an image`);
      }
      const buffer = file.buffer;
      if (!buffer || !(buffer instanceof Buffer) || buffer.length === 0) {
        throw new BadRequestException(`${label} is missing file data`);
      }
      return { buffer, mimeType };
    };

    const startFromUpload = fromUploadedImage(
      files?.startFrameFile,
      'Start frame',
    );
    const endFromUpload = isLooping
      ? null
      : fromUploadedImage(files?.endFrameFile, 'End frame');

    const startUrl = sentence.startFrameImage?.image;
    const endUrl = sentence.endFrameImage?.image;

    if (!startFromUpload && !startUrl) {
      throw new BadRequestException('Start frame image is required');
    }
    if (!isLooping && !endFromUpload && !endUrl) {
      throw new BadRequestException('End frame image is required');
    }

    const start =
      startFromUpload ??
      (await this.downloadUrlToBuffer({
        url: startUrl!,
        maxBytes: 12 * 1024 * 1024,
        label: 'start frame image',
      }));

    const end = isLooping
      ? undefined
      : (endFromUpload ??
        (endUrl
          ? await this.downloadUrlToBuffer({
              url: endUrl,
              maxBytes: 12 * 1024 * 1024,
              label: 'end frame image',
            })
          : undefined));

    const generated = await this.aiService.generateVideoFromFrames({
      prompt,
      model: dto?.model,
      resolution: dto?.resolution,
      aspectRatio: dto?.aspectRatio,
      isLooping,
      startFrame: { buffer: start.buffer, mimeType: start.mimeType },
      endFrame: end
        ? { buffer: end.buffer, mimeType: end.mimeType }
        : undefined,
    });

    const uploaded = await uploadBufferToCloudinary({
      buffer: generated.buffer,
      folder: 'auto-video-generator/sentence-videos',
      resource_type: 'video',
    });

    const videoEntity = this.videoRepository.create({
      video: uploaded.secure_url,
      user_id: userId,
      video_type: 'gemini',
      video_size: VideoSize.PORTRAIT,
    });
    const savedVideo = await this.videoRepository.save(videoEntity);

    sentence.video_id = savedVideo.id;
    await this.sentenceRepository.save(sentence);

    return this.findOne(scriptId, userId);
  }

  async updateSentenceMedia(
    scriptId: string,
    sentenceId: string,
    userId: string,
    dto: UpdateSentenceMediaDto,
  ): Promise<Script> {
    const script = await this.scriptRepository.findOne({
      where: { id: scriptId, user_id: userId },
      select: { id: true, user_id: true },
    });

    if (!script) {
      throw new NotFoundException('Script not found');
    }

    const sentence = await this.sentenceRepository.findOne({
      where: { id: sentenceId, script_id: scriptId },
    });

    if (!sentence) {
      throw new NotFoundException('Sentence not found');
    }

    const startIdProvided = dto.start_frame_image_id !== undefined;
    const endIdProvided = dto.end_frame_image_id !== undefined;
    const videoIdProvided = dto.video_id !== undefined;

    if (startIdProvided && dto.start_frame_image_id) {
      const image = await this.imageRepository.findOne({
        where: { id: dto.start_frame_image_id, user_id: userId },
        select: { id: true },
      });
      if (!image) {
        throw new NotFoundException('Start frame image not found');
      }
    }

    if (endIdProvided && dto.end_frame_image_id) {
      const image = await this.imageRepository.findOne({
        where: { id: dto.end_frame_image_id, user_id: userId },
        select: { id: true },
      });
      if (!image) {
        throw new NotFoundException('End frame image not found');
      }
    }

    if (videoIdProvided && dto.video_id) {
      const video = await this.videoRepository.findOne({
        where: { id: dto.video_id, user_id: userId },
        select: { id: true },
      });
      if (!video) {
        throw new NotFoundException('Sentence video not found');
      }
    }

    if (startIdProvided) {
      sentence.start_frame_image_id = dto.start_frame_image_id ?? null;
    }
    if (endIdProvided) {
      sentence.end_frame_image_id = dto.end_frame_image_id ?? null;
    }
    if (videoIdProvided) {
      sentence.video_id = dto.video_id ?? null;
    }

    await this.sentenceRepository.save(sentence);
    return this.findOne(scriptId, userId);
  }

  async findByScriptText(
    userId: string,
    scriptText: string,
  ): Promise<Script | null> {
    const trimmed = (scriptText ?? '').trim();
    if (!trimmed) return null;

    return this.scriptRepository.findOne({
      where: {
        user_id: userId,
        script: trimmed,
      },
    });
  }

  async create(
    userId: string,
    createScriptDto: CreateScriptDto,
  ): Promise<Script> {
    const {
      script,
      subject,
      subject_content,
      length,
      style,
      technique,
      reference_script_ids,
      message_id,
      voice_id,
      video_url,
      sentences,
      title: providedTitle,
    } = createScriptDto;
    const trimmedScript = script.trim();

    const cleanedSubject =
      subject === undefined ? undefined : (subject ?? '').trim() || null;
    const cleanedSubjectContent =
      subject_content === undefined
        ? undefined
        : (subject_content ?? '').trim() || null;
    const cleanedLength =
      length === undefined ? undefined : (length ?? '').trim() || null;
    const cleanedStyle =
      style === undefined ? undefined : (style ?? '').trim() || null;
    const cleanedTechnique =
      technique === undefined ? undefined : (technique ?? '').trim() || null;

    const cleanedVideoUrl =
      video_url === undefined ? undefined : (video_url ?? '').trim() || null;

    const cleanedReferenceIds =
      reference_script_ids === undefined
        ? undefined
        : Array.from(new Set((reference_script_ids ?? []).filter(Boolean)));

    const referenceScripts =
      cleanedReferenceIds === undefined
        ? undefined
        : cleanedReferenceIds.length > 0
          ? await this.scriptRepository.find({
              where: { id: In(cleanedReferenceIds), user_id: userId },
              select: { id: true, title: true, script: true, user_id: true },
            })
          : [];

    if (
      referenceScripts &&
      cleanedReferenceIds &&
      referenceScripts.length !== cleanedReferenceIds.length
    ) {
      // If any provided IDs don't belong to the user (or don't exist), ignore them rather than erroring.
      // This keeps drafts resilient if a referenced script was deleted.
    }

    // If an identical script already exists for this user, update it instead
    // of creating a new row, similar to how images are de-duplicated.
    const existingScript = await this.scriptRepository.findOne({
      where: {
        user_id: userId,
        script: trimmedScript,
      },
    });

    if (existingScript) {
      // Prefer an explicitly provided title; otherwise, keep the existing one.
      const newTitle = providedTitle?.trim() || existingScript.title;

      existingScript.title = newTitle ?? null;
      existingScript.message_id = message_id ?? existingScript.message_id;
      existingScript.voice_id = voice_id ?? existingScript.voice_id;

      if (cleanedVideoUrl !== undefined) {
        existingScript.video_url = cleanedVideoUrl;
      }

      if (cleanedSubject !== undefined) existingScript.subject = cleanedSubject;
      if (cleanedSubjectContent !== undefined) {
        existingScript.subject_content = cleanedSubjectContent;
      }
      if (cleanedLength !== undefined) existingScript.length = cleanedLength;
      if (cleanedStyle !== undefined) existingScript.style = cleanedStyle;
      if (cleanedTechnique !== undefined)
        existingScript.technique = cleanedTechnique;

      if (referenceScripts !== undefined) {
        existingScript.reference_scripts = referenceScripts;
      }

      const updatedScript = await this.scriptRepository.save(existingScript);

      if (sentences && sentences.length > 0) {
        // Replace existing sentences with the new ones
        await this.sentenceRepository.delete({ script_id: updatedScript.id });

        let suspenseAlreadyUsed = false;
        const sentenceEntities = sentences.map((s, index) => {
          const wantsSuspense = Boolean(s.isSuspense);
          const isSuspense = wantsSuspense && !suspenseAlreadyUsed;
          if (isSuspense) suspenseAlreadyUsed = true;

          return this.sentenceRepository.create({
            text: s.text,
            index,
            script_id: updatedScript.id,
            image_id: s.image_id ?? null,
            start_frame_image_id: s.start_frame_image_id ?? null,
            end_frame_image_id: s.end_frame_image_id ?? null,
            video_id: s.video_id ?? null,
            isSuspense,
          });
        });

        await this.sentenceRepository.save(sentenceEntities);
      }

      return this.findOne(updatedScript.id, userId);
    }

    const title =
      (providedTitle && providedTitle.trim()) ||
      (await this.aiService.generateTitleForScript(trimmedScript));

    const scriptEntity = this.scriptRepository.create({
      script: trimmedScript,
      user_id: userId,
      message_id: message_id ?? null,
      voice_id: voice_id ?? null,
      video_url: cleanedVideoUrl ?? null,
      title: title || null,
      subject: cleanedSubject ?? null,
      subject_content: cleanedSubjectContent ?? null,
      length: cleanedLength ?? null,
      style: cleanedStyle ?? null,
      technique: cleanedTechnique ?? null,
    });

    if (referenceScripts !== undefined) {
      scriptEntity.reference_scripts = referenceScripts;
    }

    const savedScript = await this.scriptRepository.save(scriptEntity);

    if (sentences && sentences.length > 0) {
      let suspenseAlreadyUsed = false;
      const sentenceEntities = sentences.map((s, index) => {
        const wantsSuspense = Boolean(s.isSuspense);
        const isSuspense = wantsSuspense && !suspenseAlreadyUsed;
        if (isSuspense) suspenseAlreadyUsed = true;

        return this.sentenceRepository.create({
          text: s.text,
          index,
          script_id: savedScript.id,
          image_id: s.image_id ?? null,
          start_frame_image_id: s.start_frame_image_id ?? null,
          end_frame_image_id: s.end_frame_image_id ?? null,
          video_id: s.video_id ?? null,
          isSuspense,
        });
      });

      await this.sentenceRepository.save(sentenceEntities);
    }

    return this.findOne(savedScript.id, userId);
  }

  async findAllByUser(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{ items: Script[]; total: number; page: number; limit: number }> {
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeLimit =
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 50) : 20;

    // Performance notes:
    // 1) Always filter by user_id.
    // 2) Avoid doing pagination (skip/take) against a query that joins 1:N tables
    //    (sentences), because it explodes row counts and can paginate incorrectly.
    // Instead, page script IDs first, then load relations only for those IDs.

    const [idRows, total] = await Promise.all([
      this.scriptRepository
        .createQueryBuilder('script')
        .select('script.id', 'id')
        .where('script.user_id = :userId', { userId })
        .orderBy('script.created_at', 'DESC')
        .skip((safePage - 1) * safeLimit)
        .take(safeLimit)
        .getRawMany<{ id: string }>(),

      // Count without joins to avoid inflated totals from 1:N sentence joins.
      this.scriptRepository.count({ where: { user_id: userId } }),
    ]);

    const ids = idRows.map((r) => r.id).filter(Boolean);
    if (ids.length === 0) {
      return { items: [], total, page: safePage, limit: safeLimit };
    }

    // Use an explicit QueryBuilder so we can guarantee selecting `image.prompt`
    // even if the Image entity later marks it as `select: false`.
    const items = await this.scriptRepository
      .createQueryBuilder('script')
      .leftJoinAndSelect('script.sentences', 'sentence')
      .leftJoinAndSelect('sentence.image', 'image')
      .leftJoinAndSelect('sentence.startFrameImage', 'start_frame_image')
      .leftJoinAndSelect('sentence.endFrameImage', 'end_frame_image')
      .leftJoinAndSelect('sentence.video', 'sentence_video')
      .leftJoinAndSelect('script.voice', 'voice')
      .leftJoinAndSelect('script.reference_scripts', 'reference_script')
      .addSelect('image.prompt')
      .addSelect('start_frame_image.prompt')
      .addSelect('end_frame_image.prompt')
      .where('script.user_id = :userId', { userId })
      .andWhere('script.id IN (:...ids)', { ids })
      .orderBy('script.created_at', 'DESC')
      .addOrderBy('sentence.index', 'ASC')
      .getMany();

    return { items, total, page: safePage, limit: safeLimit };
  }

  async findOne(id: string, userId: string): Promise<Script> {
    const script = await this.scriptRepository
      .createQueryBuilder('script')
      .leftJoinAndSelect('script.sentences', 'sentence')
      .leftJoinAndSelect('sentence.image', 'image')
      .leftJoinAndSelect('sentence.startFrameImage', 'start_frame_image')
      .leftJoinAndSelect('sentence.endFrameImage', 'end_frame_image')
      .leftJoinAndSelect('sentence.video', 'sentence_video')
      .leftJoinAndSelect('script.voice', 'voice')
      .leftJoinAndSelect('script.reference_scripts', 'reference_script')
      .addSelect('image.prompt')
      .addSelect('start_frame_image.prompt')
      .addSelect('end_frame_image.prompt')
      .where('script.id = :id', { id })
      .andWhere('script.user_id = :userId', { userId })
      .orderBy('sentence.index', 'ASC')
      .getOne();

    if (!script) {
      throw new NotFoundException('Script not found');
    }

    return script;
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateScriptDto,
  ): Promise<Script> {
    const script = await this.scriptRepository.findOne({
      where: { id, user_id: userId },
      relations: ['sentences'],
    });

    if (!script) {
      throw new NotFoundException('Script not found');
    }

    if (dto.script !== undefined) {
      const trimmedScript = (dto.script ?? '').trim();
      script.script = trimmedScript;
    }

    if (dto.subject !== undefined) {
      const trimmed = (dto.subject ?? '').trim();
      script.subject = trimmed ? trimmed : null;
    }

    if (dto.subject_content !== undefined) {
      const trimmed = (dto.subject_content ?? '').trim();
      script.subject_content = trimmed ? trimmed : null;
    }

    if (dto.length !== undefined) {
      const trimmed = (dto.length ?? '').trim();
      script.length = trimmed ? trimmed : null;
    }

    if (dto.style !== undefined) {
      const trimmed = (dto.style ?? '').trim();
      script.style = trimmed ? trimmed : null;
    }

    if (dto.technique !== undefined) {
      const trimmed = (dto.technique ?? '').trim();
      script.technique = trimmed ? trimmed : null;
    }

    if (dto.reference_script_ids !== undefined) {
      const uniqueIds = Array.from(
        new Set((dto.reference_script_ids ?? []).filter(Boolean)),
      );
      if (uniqueIds.length === 0) {
        script.reference_scripts = [];
      } else {
        // Ignore missing/deleted scripts so updates don't fail if a reference was removed.
        const refs = await this.scriptRepository.find({
          where: { id: In(uniqueIds), user_id: userId },
          select: { id: true, title: true, script: true, user_id: true },
        });
        script.reference_scripts = refs;
      }
    }

    if (dto.title !== undefined) {
      const trimmedTitle = (dto.title ?? '').trim();
      script.title = trimmedTitle ? trimmedTitle : null;
    }

    if (dto.voice_id !== undefined) {
      script.voice_id = dto.voice_id ?? null;
    }

    await this.scriptRepository.save(script);

    if (dto.sentences !== undefined) {
      await this.sentenceRepository.delete({ script_id: script.id });

      if (dto.sentences.length > 0) {
        let suspenseAlreadyUsed = false;
        const sentenceEntities = dto.sentences.map((s, index) => {
          const wantsSuspense = Boolean(s.isSuspense);
          const isSuspense = wantsSuspense && !suspenseAlreadyUsed;
          if (isSuspense) suspenseAlreadyUsed = true;

          return this.sentenceRepository.create({
            text: s.text,
            index,
            script_id: script.id,
            image_id: s.image_id ?? null,
            start_frame_image_id: s.start_frame_image_id ?? null,
            end_frame_image_id: s.end_frame_image_id ?? null,
            video_id: s.video_id ?? null,
            isSuspense,
          });
        });
        await this.sentenceRepository.save(sentenceEntities);
      }
    }

    return this.findOne(id, userId);
  }

  async remove(id: string, userId: string): Promise<{ deleted: true }> {
    const existing = await this.scriptRepository.findOne({
      where: { id, user_id: userId },
    });

    if (!existing) {
      throw new NotFoundException('Script not found');
    }

    await this.sentenceRepository.delete({ script_id: id });
    await this.scriptRepository.delete({ id, user_id: userId });
    return { deleted: true };
  }
}
