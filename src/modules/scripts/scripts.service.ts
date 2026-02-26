import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { extname, join, sep } from 'path';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
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
export class ScriptsService implements OnModuleInit {
  private scriptsSchemaEnsuring: Promise<void> | null = null;
  private scriptsSchemaEnsured = false;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
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

  async onModuleInit() {
    // Best-effort on boot. We also call this lazily in request paths because
    // in some setups the `scripts` table may not exist yet during module init.
    await this.ensureScriptsSchemaLazy();
  }

  private async scriptsTableExists(): Promise<boolean> {
    try {
      const rows = (await this.dataSource.query(
        "SELECT to_regclass('scripts') as reg",
      )) as Array<{ reg: string | null }>;
      return Boolean(rows?.[0]?.reg);
    } catch {
      return false;
    }
  }

  private async scriptsColumnExists(columnName: string): Promise<boolean> {
    const name = String(columnName ?? '').trim();
    if (!name) return false;

    try {
      const rows = (await this.dataSource.query(
        `
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'scripts'
            AND column_name = $1
          LIMIT 1
        `,
        [name],
      )) as unknown[];
      return rows.length > 0;
    } catch {
      return false;
    }
  }

  private async ensureScriptsSchemaLazy(): Promise<void> {
    if (this.scriptsSchemaEnsured) return;
    if (this.scriptsSchemaEnsuring) return this.scriptsSchemaEnsuring;

    this.scriptsSchemaEnsuring = (async () => {
      const tableExists = await this.scriptsTableExists();
      if (!tableExists) return;

      const hasIsShortScript = await this.scriptsColumnExists('isShortScript');
      const hasShortsScripts = await this.scriptsColumnExists('shorts_scripts');
      const hasYoutubeUrl = await this.scriptsColumnExists('youtube_url');

      if (!hasIsShortScript || !hasShortsScripts || !hasYoutubeUrl) {
        await this.ensureScriptsSchema();
      }

      const finalHasIsShortScript = await this.scriptsColumnExists('isShortScript');
      const finalHasShortsScripts = await this.scriptsColumnExists('shorts_scripts');
      const finalHasYoutubeUrl = await this.scriptsColumnExists('youtube_url');

      if (!finalHasIsShortScript || !finalHasShortsScripts || !finalHasYoutubeUrl) {
        throw new InternalServerErrorException(
          'Database schema is missing required columns on `scripts` (expected: "isShortScript", shorts_scripts, youtube_url). ' +
            'Ensure your DB user has ALTER permissions, or apply the schema update SQL in `ScriptsService.ensureScriptsSchema()`.',
        );
      }

      this.scriptsSchemaEnsured = true;
    })().finally(() => {
      this.scriptsSchemaEnsuring = null;
    });

    return this.scriptsSchemaEnsuring;
  }

  private async ensureScriptsSchema() {
    // Older DBs may have the scripts table without newer columns.
    // This guard avoids runtime errors like:
    // QueryFailedError: column script.isShortScript does not exist
    const tableExists = await this.scriptsTableExists();
    if (!tableExists) return;

    try {
      await this.dataSource.query(
        'ALTER TABLE scripts ADD COLUMN IF NOT EXISTS "isShortScript" BOOLEAN NOT NULL DEFAULT false',
      );
    } catch (err: any) {
      const message = String(err?.message || '');
      if (
        message.includes('does not exist') ||
        message.includes('permission denied')
      ) {
        return;
      }
      throw err;
    }

    // shorts_scripts is stored on the parent script as an ordered list of short IDs.
    try {
      await this.dataSource.query(
        'ALTER TABLE scripts ADD COLUMN IF NOT EXISTS shorts_scripts JSONB NULL',
      );
    } catch (err: any) {
      const message = String(err?.message || '');
      if (
        message.includes('does not exist') ||
        message.includes('permission denied')
      ) {
        return;
      }
      throw err;
    }

    // Optional YouTube URL for the uploaded video.
    try {
      await this.dataSource.query(
        'ALTER TABLE scripts ADD COLUMN IF NOT EXISTS youtube_url VARCHAR(2048) NULL',
      );
    } catch (err: any) {
      const message = String(err?.message || '');
      if (
        message.includes('does not exist') ||
        message.includes('permission denied')
      ) {
        return;
      }
      throw err;
    }
  }

  private getPublicBaseUrl() {
    return (
      process.env.REMOTION_ASSET_BASE_URL ??
      `http://127.0.0.1:${process.env.PORT ?? 3000}`
    );
  }

  private getStorageRoot() {
    return join(process.cwd(), 'storage');
  }

  private ensureDir(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private toStaticUrl(relPath: string) {
    const normalized = relPath.split(sep).join('/');
    return `${this.getPublicBaseUrl()}/static/${normalized}`;
  }

  private inferVideoExt(params: {
    originalName?: string;
    mimeType?: string;
  }) {
    const fromName = extname(String(params.originalName ?? '').trim());
    if (fromName) return fromName;
    const mt = String(params.mimeType ?? '').toLowerCase();
    if (mt.includes('webm')) return '.webm';
    if (mt.includes('quicktime')) return '.mov';
    return '.mp4';
  }

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

  private normalizeShortsPayload(
    raw: any,
  ):
    | Array<{
        script: string;
        title?: string | null;
        video_url?: string | null;
        sentences?: any[];
        characters?: any[];
      }>
    | null {
    if (raw === null) return [];
    if (raw === undefined) return null;
    if (!Array.isArray(raw)) return null;

    return raw
      .map((item) => ({
        script: String(item?.script ?? '').trim(),
        title:
          item?.title === undefined ? undefined : String(item?.title ?? '').trim() || null,
        video_url:
          item?.video_url === undefined
            ? undefined
            : String(item?.video_url ?? '').trim() || null,
        sentences: Array.isArray(item?.sentences) ? item.sentences : undefined,
        characters: Array.isArray(item?.characters) ? item.characters : undefined,
      }))
      .filter((v) => v.script);
  }

  private normalizeShortIdsPayload(raw: any): string[] | null {
    if (raw === undefined) return null;
    if (raw === null) return [];
    if (!Array.isArray(raw)) return null;

    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      const id = String(item ?? '').trim();
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  private async applyShortScriptIdsLinking(params: {
    userId: string;
    parent: Script;
    shortIds: string[];
  }): Promise<void> {
    const { userId, parent, shortIds } = params;

    const existingIds = Array.isArray((parent as any).shorts_scripts)
      ? ((parent as any).shorts_scripts as string[])
      : [];

    if (shortIds.length === 0) {
      if (existingIds.length > 0) {
        await this.deleteShortScriptsByIds(userId, existingIds);
      }
      await this.scriptRepository.update(
        { id: parent.id, user_id: userId } as any,
        { shorts_scripts: null } as any,
      );
      return;
    }

    const rows = await this.scriptRepository.find({
      where: { id: In(shortIds), user_id: userId },
      select: { id: true },
    });
    const owned = new Set(rows.map((r) => r.id));
    const missing = shortIds.filter((id) => !owned.has(id));
    if (missing.length > 0) {
      throw new BadRequestException('One or more short script IDs are invalid');
    }

    // Ensure linked scripts are marked as shorts so they are hidden from the library listing.
    await this.scriptRepository.update(
      { id: In(shortIds) as any, user_id: userId } as any,
      { isShortScript: true } as any,
    );

    // Delete any previously-linked shorts that are no longer referenced.
    const nextSet = new Set(shortIds);
    const toDelete = existingIds.filter((id) => id && !nextSet.has(id));
    if (toDelete.length > 0) {
      await this.deleteShortScriptsByIds(userId, toDelete);
    }

    await this.scriptRepository.update(
      { id: parent.id, user_id: userId } as any,
      { shorts_scripts: shortIds } as any,
    );
  }

  private async deleteShortScriptsByIds(userId: string, ids: string[]) {
    const uniqueIds = Array.from(new Set((ids ?? []).filter(Boolean)));
    if (uniqueIds.length === 0) return;

    // Ensure only user's scripts are touched.
    const rows = await this.scriptRepository.find({
      where: {
        id: In(uniqueIds),
        user_id: userId,
      },
      select: { id: true },
    });
    const ownedIds = rows.map((r) => r.id);
    if (ownedIds.length === 0) return;

    await this.sentenceRepository.delete({ script_id: In(ownedIds) as any });
    await this.scriptRepository.delete({ id: In(ownedIds) as any, user_id: userId } as any);
  }

  private async isScriptReferencedAsShort(params: {
    userId: string;
    scriptId: string;
  }): Promise<boolean> {
    const { userId, scriptId } = params;
    const id = String(scriptId ?? '').trim();
    if (!id) return false;

    const row = await this.scriptRepository
      .createQueryBuilder('parent')
      .select('parent.id', 'id')
      .where('parent.user_id = :userId', { userId })
      .andWhere('parent.shorts_scripts IS NOT NULL')
      .andWhere('parent.shorts_scripts ? :scriptId', { scriptId: id })
      .limit(1)
      .getRawOne<{ id: string }>();

    return Boolean(row?.id);
  }

  private async syncShortScripts(params: {
    userId: string;
    parent: Script;
    shorts: Array<{
      script: string;
      title?: string | null;
      video_url?: string | null;
      sentences?: any[];
      characters?: any[];
    }>;
  }): Promise<void> {
    const { userId, parent, shorts } = params;

    const existingIds = Array.isArray((parent as any).shorts_scripts)
      ? ((parent as any).shorts_scripts as string[])
      : [];

    const nextIds: string[] = [];

    for (let i = 0; i < shorts.length; i += 1) {
      const item = shorts[i];
      const existingId = existingIds[i];

      const baseTitle =
        item.title !== undefined
          ? item.title
          : parent.title
            ? `${parent.title} - Short ${i + 1}`
            : `Short ${i + 1}`;

      const cleanedVideoUrl =
        item.video_url === undefined ? undefined : (item.video_url ?? null);

      let shortScript: Script;

      if (existingId) {
        const found = await this.scriptRepository.findOne({
          where: { id: existingId, user_id: userId },
        });

        if (found) {
          found.isShortScript = true;
          found.script = item.script;
          found.title = baseTitle ?? null;
          found.voice_id = null;
          found.subject = parent.subject;
          found.subject_content = parent.subject_content;
          found.length = parent.length;
          found.style = parent.style;
          found.technique = parent.technique;
          found.characters =
            item.characters && item.characters.length > 0
              ? (item.characters as any)
              : parent.characters;
          if (cleanedVideoUrl !== undefined) {
            found.video_url = cleanedVideoUrl;
          }

          shortScript = await this.scriptRepository.save(found);
        } else {
          shortScript = await this.scriptRepository.save(
            this.scriptRepository.create({
              user_id: userId,
              isShortScript: true,
              script: item.script,
              title: baseTitle ?? null,
              voice_id: null,
              video_url: cleanedVideoUrl ?? null,
              subject: parent.subject,
              subject_content: parent.subject_content,
              length: parent.length,
              style: parent.style,
              technique: parent.technique,
              characters:
                item.characters && item.characters.length > 0
                  ? (item.characters as any)
                  : parent.characters,
            }),
          );
        }
      } else {
        shortScript = await this.scriptRepository.save(
          this.scriptRepository.create({
            user_id: userId,
            isShortScript: true,
            script: item.script,
            title: baseTitle ?? null,
            voice_id: null,
            video_url: cleanedVideoUrl ?? null,
            subject: parent.subject,
            subject_content: parent.subject_content,
            length: parent.length,
            style: parent.style,
            technique: parent.technique,
            characters:
              item.characters && item.characters.length > 0
                ? (item.characters as any)
                : parent.characters,
          }),
        );
      }

      if (item.sentences !== undefined) {
        await this.sentenceRepository.delete({ script_id: shortScript.id });

        if (item.sentences.length > 0) {
          let suspenseAlreadyUsed = false;
          const sentenceEntities = item.sentences.map((s: any, index: number) => {
            const wantsSuspense = Boolean(s.isSuspense);
            const isSuspense = wantsSuspense && !suspenseAlreadyUsed;
            if (isSuspense) suspenseAlreadyUsed = true;

            return this.sentenceRepository.create({
              text: String(s.text ?? ''),
              index,
              script_id: shortScript.id,
              image_id: s.image_id ?? null,
              start_frame_image_id: s.start_frame_image_id ?? null,
              end_frame_image_id: s.end_frame_image_id ?? null,
              video_id: s.video_id ?? null,
              transition_to_next: (s as any).transition_to_next ?? null,
              visual_effect: (s as any).visual_effect ?? null,
              isSuspense,
              forced_character_keys:
                Array.isArray((s as any).forced_character_keys) &&
                (s as any).forced_character_keys.length > 0
                  ? (s as any).forced_character_keys
                  : null,
            });
          });

          await this.sentenceRepository.save(sentenceEntities);
        }
      }

      nextIds.push(shortScript.id);
    }

    // Delete any leftover old shorts beyond the new list.
    const toDelete = existingIds.slice(nextIds.length).filter(Boolean);
    if (toDelete.length > 0) {
      await this.deleteShortScriptsByIds(userId, toDelete);
    }

    // Avoid saving the full parent entity (which may have relations loaded) to prevent cascade side-effects.
    await this.scriptRepository.update(
      { id: parent.id, user_id: userId } as any,
      { shorts_scripts: nextIds.length > 0 ? nextIds : null } as any,
    );
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

      const ext = this.inferVideoExt({
        originalName: file?.originalname,
        mimeType,
      });
      const fileName = `${randomUUID()}${ext}`;
      const relPath = join('sentence-videos', fileName);
      const absDir = join(this.getStorageRoot(), 'sentence-videos');
      this.ensureDir(absDir);
      fs.writeFileSync(join(this.getStorageRoot(), relPath), file!.buffer);

      finalVideoUrl = this.toStaticUrl(relPath);
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

    const ext = this.inferVideoExt({ mimeType: generated.mimeType });
    const fileName = `${randomUUID()}${ext}`;
    const relPath = join('sentence-videos', fileName);
    const absDir = join(this.getStorageRoot(), 'sentence-videos');
    this.ensureDir(absDir);
    fs.writeFileSync(join(this.getStorageRoot(), relPath), generated.buffer);
    const finalVideoUrl = this.toStaticUrl(relPath);

    const videoEntity = this.videoRepository.create({
      video: finalVideoUrl,
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
    await this.ensureScriptsSchemaLazy();
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
    await this.ensureScriptsSchemaLazy();
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
      youtube_url,
      sentences,
      characters,
      title: providedTitle,
      shorts_scripts,
      shorts_script_ids,
      is_short_script,
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

    const cleanedYoutubeUrl =
      youtube_url === undefined
        ? undefined
        : (youtube_url ?? '').trim() || null;

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

      if (cleanedYoutubeUrl !== undefined) {
        existingScript.youtube_url = cleanedYoutubeUrl;
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

      if (characters !== undefined) {
        existingScript.characters =
          characters.length > 0 ? (characters as any) : null;
      }

      if (is_short_script !== undefined) {
        existingScript.isShortScript = Boolean(is_short_script);
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
            transition_to_next: (s as any).transition_to_next ?? null,
            visual_effect: (s as any).visual_effect ?? null,
            isSuspense,
            forced_character_keys:
              Array.isArray((s as any).forced_character_keys) &&
              (s as any).forced_character_keys.length > 0
                ? (s as any).forced_character_keys
                : null,
          });
        });

        await this.sentenceRepository.save(sentenceEntities);
      }

      const normalizedShorts = this.normalizeShortsPayload(shorts_scripts);
      const normalizedShortIds = this.normalizeShortIdsPayload(shorts_script_ids);

      if (normalizedShortIds !== null) {
        await this.applyShortScriptIdsLinking({
          userId,
          parent: updatedScript,
          shortIds: normalizedShortIds,
        });
      } else if (normalizedShorts !== null) {
        if (normalizedShorts.length === 0) {
          const existingIds = Array.isArray((updatedScript as any).shorts_scripts)
            ? ((updatedScript as any).shorts_scripts as string[])
            : [];
          if (existingIds.length > 0) {
            await this.deleteShortScriptsByIds(userId, existingIds);
          }
          (updatedScript as any).shorts_scripts = null;
          await this.scriptRepository.save(updatedScript);
        } else {
          await this.syncShortScripts({
            userId,
            parent: updatedScript,
            shorts: normalizedShorts,
          });
        }
      }

      return this.findOne(updatedScript.id, userId);
    }

    const title =
      (providedTitle && providedTitle.trim()) ||
      (await this.aiService.generateTitleForScript(trimmedScript));

    const scriptEntity = this.scriptRepository.create({
      script: trimmedScript,
      user_id: userId,
      isShortScript: Boolean(is_short_script),
      message_id: message_id ?? null,
      voice_id: voice_id ?? null,
      video_url: cleanedVideoUrl ?? null,
      youtube_url: cleanedYoutubeUrl ?? null,
      title: title || null,
      subject: cleanedSubject ?? null,
      subject_content: cleanedSubjectContent ?? null,
      length: cleanedLength ?? null,
      style: cleanedStyle ?? null,
      technique: cleanedTechnique ?? null,
      characters:
        characters && characters.length > 0 ? (characters as any) : null,
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
          transition_to_next: (s as any).transition_to_next ?? null,
          visual_effect: (s as any).visual_effect ?? null,
          isSuspense,
          forced_character_keys:
            Array.isArray((s as any).forced_character_keys) &&
            (s as any).forced_character_keys.length > 0
              ? (s as any).forced_character_keys
              : null,
        });
      });

      await this.sentenceRepository.save(sentenceEntities);
    }

    const normalizedShorts = this.normalizeShortsPayload(shorts_scripts);
    const normalizedShortIds = this.normalizeShortIdsPayload(shorts_script_ids);

    if (normalizedShortIds !== null) {
      await this.applyShortScriptIdsLinking({
        userId,
        parent: savedScript,
        shortIds: normalizedShortIds,
      });
    } else if (normalizedShorts !== null) {
      if (normalizedShorts.length === 0) {
        (savedScript as any).shorts_scripts = null;
        await this.scriptRepository.save(savedScript);
      } else {
        await this.syncShortScripts({
          userId,
          parent: savedScript,
          shorts: normalizedShorts,
        });
      }
    }

    return this.findOne(savedScript.id, userId);
  }

  async findAllByUser(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{ items: Script[]; total: number; page: number; limit: number }> {
    await this.ensureScriptsSchemaLazy();
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
        .andWhere('(script.isShortScript IS NULL OR script.isShortScript = false)')
        .andWhere(
          `NOT EXISTS (
            SELECT 1 FROM scripts parent
            WHERE parent.user_id = :userId
              AND parent.shorts_scripts IS NOT NULL
              AND parent.shorts_scripts ? script.id::text
          )`,
        )
        .orderBy('script.created_at', 'DESC')
        .skip((safePage - 1) * safeLimit)
        .take(safeLimit)
        .getRawMany<{ id: string }>(),

      // Count without joins to avoid inflated totals from 1:N sentence joins.
      this.scriptRepository
        .createQueryBuilder('script')
        .where('script.user_id = :userId', { userId })
        .andWhere('(script.isShortScript IS NULL OR script.isShortScript = false)')
        .andWhere(
          `NOT EXISTS (
            SELECT 1 FROM scripts parent
            WHERE parent.user_id = :userId
              AND parent.shorts_scripts IS NOT NULL
              AND parent.shorts_scripts ? script.id::text
          )`,
        )
        .getCount(),
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
      .andWhere('(script.isShortScript IS NULL OR script.isShortScript = false)')
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM scripts parent
          WHERE parent.user_id = :userId
            AND parent.shorts_scripts IS NOT NULL
            AND parent.shorts_scripts ? script.id::text
        )`,
      )
      .andWhere('script.id IN (:...ids)', { ids })
      .orderBy('script.created_at', 'DESC')
      .addOrderBy('sentence.index', 'ASC')
      .getMany();

    return { items, total, page: safePage, limit: safeLimit };
  }

  async findOne(id: string, userId: string): Promise<Script> {
    await this.ensureScriptsSchemaLazy();
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
    await this.ensureScriptsSchemaLazy();
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

    if (dto.characters !== undefined) {
      script.characters =
        dto.characters && dto.characters.length > 0
          ? (dto.characters as any)
          : null;
    }

    if (dto.title !== undefined) {
      const trimmedTitle = (dto.title ?? '').trim();
      script.title = trimmedTitle ? trimmedTitle : null;
    }

    if ((dto as any).is_short_script !== undefined) {
      const desired = Boolean((dto as any).is_short_script);

      if (!desired && script.isShortScript) {
        const isReferenced = await this.isScriptReferencedAsShort({
          userId,
          scriptId: script.id,
        });
        if (!isReferenced) {
          script.isShortScript = false;
        }
      } else {
        script.isShortScript = desired;
      }
    }

    if (dto.voice_id !== undefined) {
      script.voice_id = dto.voice_id ?? null;
    }

    if ((dto as any).video_url !== undefined) {
      const cleanedVideoUrl = String((dto as any).video_url ?? '').trim();
      script.video_url = cleanedVideoUrl ? cleanedVideoUrl : null;
    }

    if ((dto as any).youtube_url !== undefined) {
      const cleanedYoutubeUrl = String((dto as any).youtube_url ?? '').trim();
      script.youtube_url = cleanedYoutubeUrl ? cleanedYoutubeUrl : null;
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
            transition_to_next: (s as any).transition_to_next ?? null,
            visual_effect: (s as any).visual_effect ?? null,
            isSuspense,
            forced_character_keys:
              Array.isArray((s as any).forced_character_keys) &&
              (s as any).forced_character_keys.length > 0
                ? (s as any).forced_character_keys
                : null,
          });
        });
        await this.sentenceRepository.save(sentenceEntities);
      }
    }

    const normalizedShortIds = this.normalizeShortIdsPayload(
      (dto as any).shorts_script_ids,
    );
    const normalizedShorts = this.normalizeShortsPayload((dto as any).shorts_scripts);

    if (normalizedShortIds !== null) {
      await this.applyShortScriptIdsLinking({
        userId,
        parent: script,
        shortIds: normalizedShortIds,
      });
    } else if (normalizedShorts !== null) {
      if (normalizedShorts.length === 0) {
        const existingIds = Array.isArray((script as any).shorts_scripts)
          ? ((script as any).shorts_scripts as string[])
          : [];
        if (existingIds.length > 0) {
          await this.deleteShortScriptsByIds(userId, existingIds);
        }
        (script as any).shorts_scripts = null;
        await this.scriptRepository.save(script);
      } else {
        await this.syncShortScripts({
          userId,
          parent: script,
          shorts: normalizedShorts,
        });
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
