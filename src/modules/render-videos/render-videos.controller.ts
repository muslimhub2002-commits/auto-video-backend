import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  ServiceUnavailableException,
  MethodNotAllowedException,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {
  FileFieldsInterceptor,
  FileInterceptor,
} from '@nestjs/platform-express';
import type { Multer } from 'multer';
import { ensureUuid } from '../../common/errors/ensure-uuid';
import { CreateRenderVideoDto } from './dto/create-render-video.dto';
import { CreateTestRenderVideoDto } from './dto/create-test-render-video.dto';
import { CreateRenderVideoUrlDto } from './dto/create-render-video-url.dto';
import { RenderVideosService } from './render-videos.service';
import { isSubscribeLikeSentence } from './render-videos.constants';
import {
  resolveOverlaySceneBackgroundMode,
  resolveTextSceneBackgroundMode,
  sentenceUsesPrimaryImageTransport,
  TEXT_ANIMATION_EFFECT_VALUES,
} from './render-videos.types';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const normalizeVolume = (raw: number) => {
  if (!Number.isFinite(raw)) return undefined;
  // Be forgiving: accept 0..1 (normalized) or 0..100 (percent).
  if (raw > 1 && raw <= 100) return clamp01(raw / 100);
  return clamp01(raw);
};
import type { SentenceInput } from './render-videos.types';

const LOCAL_RENDER_ASSET_MAX_BYTES = Math.max(
  100 * 1024 * 1024,
  Number(process.env.LOCAL_RENDER_ASSET_MAX_BYTES ?? 512 * 1024 * 1024) ||
    512 * 1024 * 1024,
);

@Controller('videos')
export class RenderVideosController {
  constructor(private readonly renderVideosService: RenderVideosService) {}

  private parseMultipartSentences(body: {
    sentences: string;
  }): SentenceInput[] {
    let sentences: Array<Record<string, unknown>>;

    try {
      sentences = JSON.parse(body.sentences) as typeof sentences;
    } catch {
      throw new BadRequestException('Invalid `sentences` JSON');
    }

    return sentences.map((sentence) => {
      const secondaryImageUrl =
        typeof sentence.secondaryImageUrl === 'string' &&
        sentence.secondaryImageUrl.trim().length > 0
          ? sentence.secondaryImageUrl.trim()
          : undefined;
      const videoUrl =
        typeof sentence.videoUrl === 'string' &&
        sentence.videoUrl.trim().length > 0
          ? sentence.videoUrl.trim()
          : undefined;
      const textBackgroundVideoUrl =
        typeof (sentence as any).textBackgroundVideoUrl === 'string' &&
        String((sentence as any).textBackgroundVideoUrl).trim().length > 0
          ? String((sentence as any).textBackgroundVideoUrl).trim()
          : undefined;
      const overlayUrl =
        typeof (sentence as any).overlayUrl === 'string' &&
        String((sentence as any).overlayUrl).trim().length > 0
          ? String((sentence as any).overlayUrl).trim()
          : undefined;
      const overlayMimeType =
        typeof (sentence as any).overlayMimeType === 'string' &&
        String((sentence as any).overlayMimeType).trim().length > 0
          ? String((sentence as any).overlayMimeType).trim()
          : undefined;
      const mediaType =
        sentence.mediaType === 'image' ||
        sentence.mediaType === 'video' ||
        sentence.mediaType === 'text' ||
        sentence.mediaType === 'overlay'
          ? sentence.mediaType
          : undefined;
      const textAnimationEffect =
        typeof sentence.textAnimationEffect === 'string' &&
        (TEXT_ANIMATION_EFFECT_VALUES as readonly string[]).includes(
          sentence.textAnimationEffect,
        )
          ? (sentence.textAnimationEffect as SentenceInput['textAnimationEffect'])
          : undefined;
      const textAnimationText =
        typeof sentence.textAnimationText === 'string' &&
        sentence.textAnimationText.trim().length > 0
          ? sentence.textAnimationText.trim()
          : undefined;
      const textAnimationSettings =
        sentence.textAnimationSettings &&
        typeof sentence.textAnimationSettings === 'object' &&
        !Array.isArray(sentence.textAnimationSettings)
          ? (sentence.textAnimationSettings as Record<string, unknown>)
          : undefined;
      const overlaySettings =
        (sentence as any).overlaySettings &&
        typeof (sentence as any).overlaySettings === 'object' &&
        !Array.isArray((sentence as any).overlaySettings)
          ? ((sentence as any).overlaySettings as Record<string, unknown>)
          : undefined;
      const {
        secondaryImageUrl: _secondaryImageUrl,
        videoUrl: _videoUrl,
        textBackgroundVideoUrl: _textBackgroundVideoUrl,
        overlayUrl: _overlayUrl,
        overlayMimeType: _overlayMimeType,
        mediaType: _mediaType,
        textAnimationEffect: _textAnimationEffect,
        textAnimationText: _textAnimationText,
        textAnimationSettings: _textAnimationSettings,
        overlaySettings: _overlaySettings,
        ...rest
      } = sentence;

      return {
        ...(rest as SentenceInput),
        ...(mediaType ? { mediaType } : {}),
        ...(secondaryImageUrl ? { secondaryImageUrl } : {}),
        ...(videoUrl ? { videoUrl } : {}),
        ...(textBackgroundVideoUrl ? { textBackgroundVideoUrl } : {}),
        ...(overlayUrl ? { overlayUrl } : {}),
        ...(overlayMimeType ? { overlayMimeType } : {}),
        ...(textAnimationEffect ? { textAnimationEffect } : {}),
        ...(textAnimationText ? { textAnimationText } : {}),
        ...(textAnimationSettings ? { textAnimationSettings } : {}),
        ...(overlaySettings ? { overlaySettings } : {}),
      };
    });
  }

  private validateMultipartSentences(
    sentences: SentenceInput[],
    minimumCount = 1,
  ) {
    if (!Array.isArray(sentences) || sentences.length < minimumCount) {
      throw new BadRequestException(
        minimumCount > 1
          ? `\`sentences\` must contain at least ${minimumCount} items`
          : '`sentences` must be a non-empty array',
      );
    }

    const allowedTransitions = new Set([
      'none',
      'glitch',
      'whip',
      'flash',
      'fade',
      'chromaLeak',
      'impactZoom',
      'slicePush',
      'irisReveal',
      'echoStutter',
      'tiltSnap',
    ] as const);

    const allowedVisualEffects = new Set([
      'none',
      'colorGrading',
      'animatedLighting',
      'glassSubtle',
      'glassReflections',
      'glassStrong',
    ] as const);

    const allowedImageMotionEffects = new Set([
      'default',
      'slowZoomIn',
      'slowZoomOut',
      'diagonalDrift',
      'cinematicPan',
      'focusShift',
      'parallaxMotion',
      'shakeMicroMotion',
      'splitMotion',
      'rotationDrift',
    ] as const);

    const allowedTextAnimationEffects = new Set(TEXT_ANIMATION_EFFECT_VALUES);

    for (const [idx, s] of sentences.entries()) {
      const mediaType = s?.mediaType;
      if (
        mediaType &&
        mediaType !== 'image' &&
        mediaType !== 'video' &&
        mediaType !== 'text' &&
        mediaType !== 'overlay'
      ) {
        throw new BadRequestException(
          `Invalid mediaType for sentence ${idx + 1}. Expected 'image', 'video', 'text', or 'overlay'.`,
        );
      }

      const textAnimationEffect = s?.textAnimationEffect;
      if (
        textAnimationEffect != null &&
        (typeof textAnimationEffect !== 'string' ||
          !allowedTextAnimationEffects.has(textAnimationEffect))
      ) {
        throw new BadRequestException(
          `Invalid textAnimationEffect for sentence ${idx + 1}.`,
        );
      }

      const textAnimationText = s?.textAnimationText;
      if (textAnimationText != null && typeof textAnimationText !== 'string') {
        throw new BadRequestException(
          `Invalid textAnimationText for sentence ${idx + 1}.`,
        );
      }

      const textAnimationSettings = s?.textAnimationSettings;
      if (
        textAnimationSettings != null &&
        (typeof textAnimationSettings !== 'object' ||
          Array.isArray(textAnimationSettings))
      ) {
        throw new BadRequestException(
          `Invalid textAnimationSettings for sentence ${idx + 1}.`,
        );
      }

      const overlayMimeType = (s as any)?.overlayMimeType;
      if (overlayMimeType != null && typeof overlayMimeType !== 'string') {
        throw new BadRequestException(
          `Invalid overlayMimeType for sentence ${idx + 1}.`,
        );
      }

      const overlaySettings = (s as any)?.overlaySettings;
      if (
        overlaySettings != null &&
        (typeof overlaySettings !== 'object' || Array.isArray(overlaySettings))
      ) {
        throw new BadRequestException(
          `Invalid overlaySettings for sentence ${idx + 1}.`,
        );
      }

      const t = (s as any)?.transitionToNext;
      if (t != null) {
        if (typeof t !== 'string' || !allowedTransitions.has(t as any)) {
          throw new BadRequestException(
            `Invalid transitionToNext for sentence ${idx + 1}.`,
          );
        }
      }

      const ve = (s as any)?.visualEffect;
      if (ve != null) {
        if (typeof ve !== 'string' || !allowedVisualEffects.has(ve as any)) {
          throw new BadRequestException(
            `Invalid visualEffect for sentence ${idx + 1}.`,
          );
        }
      }

      const ime = (s as any)?.imageMotionEffect;
      if (ime != null) {
        if (
          typeof ime !== 'string' ||
          !allowedImageMotionEffects.has(ime as any)
        ) {
          throw new BadRequestException(
            `Invalid imageMotionEffect for sentence ${idx + 1}.`,
          );
        }
      }

      const ims = (s as any)?.imageMotionSpeed;
      if (ims != null) {
        const numericSpeed = Number(ims);
        if (
          !Number.isFinite(numericSpeed) ||
          numericSpeed < 0.5 ||
          numericSpeed > 2.5
        ) {
          throw new BadRequestException(
            `Invalid imageMotionSpeed for sentence ${idx + 1}.`,
          );
        }
      }

      const imageEffectsMode = (s as any)?.imageEffectsMode;
      if (
        imageEffectsMode != null &&
        imageEffectsMode !== 'quick' &&
        imageEffectsMode !== 'detailed'
      ) {
        throw new BadRequestException(
          `Invalid imageEffectsMode for sentence ${idx + 1}.`,
        );
      }

      const imageFilterSettings = (s as any)?.imageFilterSettings;
      if (
        imageFilterSettings != null &&
        (typeof imageFilterSettings !== 'object' ||
          Array.isArray(imageFilterSettings))
      ) {
        throw new BadRequestException(
          `Invalid imageFilterSettings for sentence ${idx + 1}.`,
        );
      }

      const imageMotionSettings = (s as any)?.imageMotionSettings;
      if (
        imageMotionSettings != null &&
        (typeof imageMotionSettings !== 'object' ||
          Array.isArray(imageMotionSettings))
      ) {
        throw new BadRequestException(
          `Invalid imageMotionSettings for sentence ${idx + 1}.`,
        );
      }

      if (mediaType === 'video') {
        const url = String(s.videoUrl ?? '').trim();
        const ok =
          url.startsWith('http://') ||
          url.startsWith('https://') ||
          url === '/subscribe.mp4';
        if (!ok) {
          throw new BadRequestException(
            `Missing or invalid videoUrl for sentence ${idx + 1} on video tab.`,
          );
        }
      }

      if (mediaType === 'overlay') {
        const overlayUrl = String((s as any).overlayUrl ?? '').trim();
        if (!overlayUrl) {
          throw new BadRequestException(
            `Missing overlayUrl for sentence ${idx + 1} on overlay tab.`,
          );
        }

        const backgroundMode = resolveOverlaySceneBackgroundMode(
          (s as any).overlaySettings,
        );
        if (backgroundMode === 'video') {
          const url = String(s.videoUrl ?? '').trim();
          const ok =
            url.startsWith('http://') ||
            url.startsWith('https://') ||
            url === '/subscribe.mp4';
          if (!ok) {
            throw new BadRequestException(
              `Missing or invalid videoUrl for sentence ${idx + 1} on overlay tab when using video background.`,
            );
          }
        }
      }

      const soundEffects = (s as any)?.soundEffects;
      const soundEffectsAlignToSceneEnd = (s as any)
        ?.soundEffectsAlignToSceneEnd;
      if (
        soundEffectsAlignToSceneEnd != null &&
        typeof soundEffectsAlignToSceneEnd !== 'boolean'
      ) {
        throw new BadRequestException(
          `Invalid soundEffectsAlignToSceneEnd for sentence ${idx + 1}.`,
        );
      }

      if (soundEffects != null) {
        if (!Array.isArray(soundEffects)) {
          throw new BadRequestException(
            `Invalid soundEffects for sentence ${idx + 1}. Expected an array.`,
          );
        }

        for (const [sfxIdx, se] of soundEffects.entries()) {
          const src = String(se?.src ?? '').trim();
          const ok = src.startsWith('http://') || src.startsWith('https://');
          if (!ok) {
            throw new BadRequestException(
              `Invalid soundEffects[${sfxIdx}] src for sentence ${idx + 1}. Expected http(s) URL.`,
            );
          }

          const delayRaw = se?.delaySeconds;
          if (delayRaw != null) {
            const v = Number(delayRaw);
            if (!Number.isFinite(v) || v < 0) {
              throw new BadRequestException(
                `Invalid soundEffects[${sfxIdx}] delaySeconds for sentence ${idx + 1}.`,
              );
            }
          }

          const durationRaw = se?.durationSeconds;
          if (durationRaw != null) {
            const v = Number(durationRaw);
            if (!Number.isFinite(v) || v < 0) {
              throw new BadRequestException(
                `Invalid soundEffects[${sfxIdx}] durationSeconds for sentence ${idx + 1}.`,
              );
            }
          }

          const trimStartRaw = se?.trimStartSeconds;
          if (trimStartRaw != null) {
            const v = Number(trimStartRaw);
            if (!Number.isFinite(v) || v < 0) {
              throw new BadRequestException(
                `Invalid soundEffects[${sfxIdx}] trimStartSeconds for sentence ${idx + 1}.`,
              );
            }
          }

          const volRaw = se?.volumePercent;
          if (volRaw != null) {
            const v = Number(volRaw);
            if (!Number.isFinite(v) || v < 0 || v > 300) {
              throw new BadRequestException(
                `Invalid soundEffects[${sfxIdx}] volumePercent for sentence ${idx + 1}.`,
              );
            }
          }
        }
      }

      const transitionSoundEffects = (s as any)?.transitionSoundEffects;
      if (transitionSoundEffects != null) {
        if (!Array.isArray(transitionSoundEffects)) {
          throw new BadRequestException(
            `Invalid transitionSoundEffects for sentence ${idx + 1}. Expected an array.`,
          );
        }

        for (const [sfxIdx, se] of transitionSoundEffects.entries()) {
          const src = String(se?.src ?? '').trim();
          const ok = src.startsWith('http://') || src.startsWith('https://');
          if (!ok) {
            throw new BadRequestException(
              `Invalid transitionSoundEffects[${sfxIdx}] src for sentence ${idx + 1}. Expected http(s) URL.`,
            );
          }

          const delayRaw = se?.delaySeconds;
          if (delayRaw != null) {
            const v = Number(delayRaw);
            if (!Number.isFinite(v) || v < 0) {
              throw new BadRequestException(
                `Invalid transitionSoundEffects[${sfxIdx}] delaySeconds for sentence ${idx + 1}.`,
              );
            }
          }

          const volRaw = se?.volumePercent;
          if (volRaw != null) {
            const v = Number(volRaw);
            if (!Number.isFinite(v) || v < 0 || v > 300) {
              throw new BadRequestException(
                `Invalid transitionSoundEffects[${sfxIdx}] volumePercent for sentence ${idx + 1}.`,
              );
            }
          }
        }
      }
    }
  }

  private alignUploadedImages(
    sentences: SentenceInput[],
    images: Multer.File[],
  ) {
    const alignedImages: Array<Multer.File | null> = [];
    let imageCursor = 0;
    for (const s of sentences) {
      const isSubscribe = isSubscribeLikeSentence(s.text || '');
      if (isSubscribe || !sentenceUsesPrimaryImageTransport(s)) {
        alignedImages.push(null);
      } else {
        alignedImages.push(images[imageCursor] ?? null);
        imageCursor += 1;
      }
    }
    return alignedImages;
  }

  private alignUploadedTextBackgroundVideos(
    sentences: SentenceInput[],
    videos: Multer.File[],
  ) {
    const alignedVideos: Array<Multer.File | null> = [];
    let videoCursor = 0;

    for (const sentence of sentences) {
      const backgroundMode = resolveTextSceneBackgroundMode(
        sentence?.textAnimationSettings,
      );
      const hasRemoteVideo = Boolean(
        String(sentence?.textBackgroundVideoUrl ?? '').trim(),
      );

      if (
        sentence?.mediaType !== 'text' ||
        backgroundMode !== 'video' ||
        hasRemoteVideo
      ) {
        alignedVideos.push(null);
        continue;
      }

      alignedVideos.push(videos[videoCursor] ?? null);
      videoCursor += 1;
    }

    return alignedVideos;
  }

  private parseMultipartRenderOptions(
    body: CreateRenderVideoDto | CreateTestRenderVideoDto,
  ) {
    const audioDurationSeconds = body.audioDurationSeconds
      ? Number(body.audioDurationSeconds)
      : undefined;

    const useLowerFps = body.useLowerFps === 'true';
    const useLowerResolution = body.useLowerResolution === 'true';
    const enableGlitchTransitions = body.enableGlitchTransitions === 'true';
    const enableLongFormSubscribeOverlay =
      typeof body.enableLongFormSubscribeOverlay === 'string'
        ? body.enableLongFormSubscribeOverlay === 'true'
        : undefined;
    const addSubtitles =
      typeof body.addSubtitles === 'string'
        ? body.addSubtitles === 'true'
        : undefined;
    const isShort =
      typeof body.isShort === 'string' ? body.isShort === 'true' : undefined;

    const rawBackgroundMusicSrc = String(body.backgroundMusicSrc ?? '').trim();
    const backgroundMusicSrc =
      rawBackgroundMusicSrc === '__none__'
        ? null
        : rawBackgroundMusicSrc
          ? rawBackgroundMusicSrc
          : undefined;

    const rawBackgroundMusicVolume = String(
      (body as any).backgroundMusicVolume ?? '',
    ).trim();
    const parsedBackgroundMusicVolume = rawBackgroundMusicVolume
      ? Number(rawBackgroundMusicVolume)
      : NaN;
    const backgroundMusicVolume = Number.isFinite(parsedBackgroundMusicVolume)
      ? normalizeVolume(parsedBackgroundMusicVolume)
      : undefined;

    return {
      audioDurationSeconds,
      useLowerFps,
      useLowerResolution,
      enableGlitchTransitions,
      enableLongFormSubscribeOverlay,
      addSubtitles,
      isShort,
      backgroundMusicSrc,
      backgroundMusicVolume,
    };
  }

  @Get()
  info() {
    // Many users try to open /videos in the browser.
    // Rendering is started via POST requests.
    throw new MethodNotAllowedException({
      message:
        'Use POST /videos (multipart) or POST /videos/url (JSON) to start a render. Use GET /videos/:id to poll status.',
      endpoints: {
        createMultipart: {
          method: 'POST',
          path: '/videos',
          contentType: 'multipart/form-data',
          fields: [
            'voiceOver (file)',
            'audioUrl (string, optional when voiceOver is omitted)',
            'images (files)',
            'textBackgroundVideos (files)',
            'sentences (json string)',
            'scriptLength',
          ],
        },
        createFromUrls: {
          method: 'POST',
          path: '/videos/url',
          contentType: 'application/json',
          fields: ['audioUrl', 'imageUrls[]', 'sentences[]', 'scriptLength'],
        },
        createTestRender: {
          method: 'POST',
          path: '/videos/test',
          contentType: 'multipart/form-data',
          fields: [
            'voiceOver (file, optional when isSilent=true)',
            'audioUrl (string, optional when voiceOver is omitted)',
            'images (files)',
            'textBackgroundVideos (files)',
            'sentences (json string)',
            'scriptLength',
            'isSilent (optional)',
          ],
        },
        poll: {
          method: 'GET',
          path: '/videos/:id',
        },
        uploadFinalVideo: {
          method: 'POST',
          path: '/videos/upload',
          contentType: 'multipart/form-data',
          fields: ['video (file)'],
        },
      },
    });
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('video', {
      limits: {
        files: 1,
        // Allow larger uploads; adjust if needed.
        fileSize: 250 * 1024 * 1024,
        fields: 10,
      },
    }),
  )
  async uploadFinalVideo(@UploadedFile() video?: Multer.File) {
    if (this.renderVideosService.isServerlessRuntime()) {
      throw new ServiceUnavailableException(
        'Uploading videos is not supported on serverless runtimes when Cloudinary video uploads are disabled.',
      );
    }

    if (!video?.buffer?.length) {
      throw new BadRequestException('Missing `video` upload');
    }

    const job = await this.renderVideosService.createUploadedVideoJob({
      videoFile: {
        buffer: video.buffer,
        originalName: video.originalname,
        mimeType: video.mimetype,
      },
    });

    return {
      id: job.id,
      status: job.status,
      videoUrl: job.videoPath,
    };
  }

  @Post('stage-local-asset')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        files: 1,
        fileSize: LOCAL_RENDER_ASSET_MAX_BYTES,
        fields: 4,
      },
    }),
  )
  async stageLocalAsset(
    @UploadedFile() file?: Multer.File,
    @Body('kind') kindRaw?: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Missing `file` upload');
    }

    const kind =
      kindRaw === 'audio' || kindRaw === 'image' || kindRaw === 'video'
        ? kindRaw
        : null;
    if (!kind) {
      throw new BadRequestException(
        '`kind` must be either `audio`, `image`, or `video`',
      );
    }

    if (
      kind === 'image' &&
      file.mimetype &&
      !file.mimetype.startsWith('image/')
    ) {
      throw new BadRequestException('Uploaded file must be an image');
    }

    if (
      kind === 'video' &&
      file.mimetype &&
      !file.mimetype.startsWith('video/')
    ) {
      throw new BadRequestException('Uploaded file must be a video');
    }

    if (
      kind === 'audio' &&
      file.mimetype &&
      file.mimetype !== 'application/octet-stream' &&
      !file.mimetype.startsWith('audio/')
    ) {
      throw new BadRequestException('Uploaded file must be audio');
    }

    return this.renderVideosService.stageLocalRenderAsset({
      kind,
      file: {
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
      },
    });
  }

  @Post('url')
  async createFromUrls(@Body() body: CreateRenderVideoUrlDto) {
    // if (this.renderVideosService.isServerlessRuntime()) {
    //   throw new ServiceUnavailableException(
    //     'Video rendering jobs cannot run reliably on Vercel Serverless. Deploy the backend to a long-running server (Render/Railway/Fly) or run a dedicated worker for Remotion rendering.',
    //   );
    // }

    if (!body?.audioUrl) {
      throw new BadRequestException('Missing `audioUrl`');
    }

    const urlSentences = body.sentences;
    if (!Array.isArray(urlSentences) || urlSentences.length === 0) {
      throw new BadRequestException('`sentences` must be a non-empty array');
    }

    const sentences: SentenceInput[] = urlSentences.map((s) => {
      const secondaryImageUrl =
        typeof (s as any).secondaryImageUrl === 'string' &&
        String((s as any).secondaryImageUrl).trim()
          ? String((s as any).secondaryImageUrl).trim()
          : undefined;
      const videoUrl =
        typeof (s as any).videoUrl === 'string' &&
        String((s as any).videoUrl).trim()
          ? String((s as any).videoUrl).trim()
          : undefined;
      const textBackgroundVideoUrl =
        typeof (s as any).textBackgroundVideoUrl === 'string' &&
        String((s as any).textBackgroundVideoUrl).trim()
          ? String((s as any).textBackgroundVideoUrl).trim()
          : undefined;
      const overlayUrl =
        typeof (s as any).overlayUrl === 'string' &&
        String((s as any).overlayUrl).trim()
          ? String((s as any).overlayUrl).trim()
          : undefined;
      const overlayMimeType =
        typeof (s as any).overlayMimeType === 'string' &&
        String((s as any).overlayMimeType).trim()
          ? String((s as any).overlayMimeType).trim()
          : undefined;
      const textAnimationText =
        typeof (s as any).textAnimationText === 'string' &&
        String((s as any).textAnimationText).trim()
          ? String((s as any).textAnimationText).trim()
          : undefined;
      const textAnimationSettings =
        (s as any).textAnimationSettings &&
        typeof (s as any).textAnimationSettings === 'object' &&
        !Array.isArray((s as any).textAnimationSettings)
          ? ((s as any).textAnimationSettings as Record<string, unknown>)
          : undefined;
      const overlaySettings =
        (s as any).overlaySettings &&
        typeof (s as any).overlaySettings === 'object' &&
        !Array.isArray((s as any).overlaySettings)
          ? ((s as any).overlaySettings as Record<string, unknown>)
          : undefined;
      const mediaType =
        s.mediaType === 'video'
          ? 'video'
          : s.mediaType === 'text'
            ? 'text'
            : s.mediaType === 'overlay'
              ? 'overlay'
              : 'image';

      return {
        text: s.text,
        isSuspense: s.isSuspense,
        soundEffectsAlignToSceneEnd: s.soundEffectsAlignToSceneEnd,
        ...(secondaryImageUrl ? { secondaryImageUrl } : {}),
        mediaType,
        ...(videoUrl ? { videoUrl } : {}),
        ...(textBackgroundVideoUrl ? { textBackgroundVideoUrl } : {}),
        ...(overlayUrl ? { overlayUrl } : {}),
        ...(overlayMimeType ? { overlayMimeType } : {}),
        ...(s.textAnimationEffect != null
          ? { textAnimationEffect: s.textAnimationEffect }
          : {}),
        ...(textAnimationText ? { textAnimationText } : {}),
        ...(textAnimationSettings ? { textAnimationSettings } : {}),
        ...(overlaySettings ? { overlaySettings } : {}),
        ...(Array.isArray((s as any).soundEffects)
          ? { soundEffects: (s as any).soundEffects }
          : {}),
        ...(Array.isArray((s as any).transitionSoundEffects)
          ? { transitionSoundEffects: (s as any).transitionSoundEffects }
          : {}),
        ...(s.transitionToNext != null
          ? { transitionToNext: s.transitionToNext }
          : {}),
        ...(s.visualEffect != null ? { visualEffect: s.visualEffect } : {}),
        ...(s.imageMotionEffect != null
          ? { imageMotionEffect: s.imageMotionEffect }
          : {}),
        ...(s.imageMotionSpeed != null
          ? { imageMotionSpeed: s.imageMotionSpeed }
          : {}),
        ...(s.imageEffectsMode != null
          ? { imageEffectsMode: s.imageEffectsMode }
          : {}),
        ...(s.imageFilterId != null ? { imageFilterId: s.imageFilterId } : {}),
        ...(s.imageFilterSettings != null
          ? { imageFilterSettings: s.imageFilterSettings }
          : {}),
        ...(s.motionEffectId != null
          ? { motionEffectId: s.motionEffectId }
          : {}),
        ...(s.imageMotionSettings != null
          ? { imageMotionSettings: s.imageMotionSettings }
          : {}),
      };
    });

    const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls : [];
    if (imageUrls.length !== sentences.length) {
      throw new BadRequestException(
        '`imageUrls` must have the same length as `sentences`',
      );
    }

    const secondaryImageUrls = Array.isArray(body.secondaryImageUrls)
      ? body.secondaryImageUrls
      : [];
    if (
      secondaryImageUrls.length > 0 &&
      secondaryImageUrls.length !== sentences.length
    ) {
      throw new BadRequestException(
        '`secondaryImageUrls` must have the same length as `sentences` when provided',
      );
    }

    const hydratedSentences: SentenceInput[] = sentences.map(
      (sentence, index) => {
        const secondaryImageUrl =
          typeof secondaryImageUrls[index] === 'string' &&
          String(secondaryImageUrls[index]).trim()
            ? String(secondaryImageUrls[index]).trim()
            : undefined;

        return {
          ...sentence,
          ...(secondaryImageUrl ? { secondaryImageUrl } : {}),
        };
      },
    );
    this.validateMultipartSentences(hydratedSentences, 1);

    const backgroundMusicVolume =
      typeof body.backgroundMusicVolume === 'number'
        ? normalizeVolume(body.backgroundMusicVolume)
        : undefined;
    const rawBackgroundMusicSrc =
      typeof body.backgroundMusicSrc === 'string'
        ? body.backgroundMusicSrc.trim()
        : body.backgroundMusicSrc;
    const backgroundMusicSrc =
      rawBackgroundMusicSrc === '__none__'
        ? null
        : typeof rawBackgroundMusicSrc === 'string' && rawBackgroundMusicSrc
          ? rawBackgroundMusicSrc
          : rawBackgroundMusicSrc === null
            ? null
            : undefined;

    const job = await this.renderVideosService.createJob({
      language:
        typeof body.language === 'string' ? body.language.trim() : undefined,
      audioFile: null,
      audioUrl: body.audioUrl,
      sentences: hydratedSentences,
      imageFiles: new Array(sentences.length).fill(null),
      textBackgroundVideoFiles: new Array(sentences.length).fill(null),
      imageUrls,
      scriptLength: body.scriptLength,
      audioDurationSeconds: body.audioDurationSeconds,
      isShort: body.isShort,
      useLowerFps: !!body.useLowerFps,
      useLowerResolution: !!body.useLowerResolution,
      addSubtitles: body.addSubtitles,
      enableGlitchTransitions: !!body.enableGlitchTransitions,
      enableLongFormSubscribeOverlay: body.enableLongFormSubscribeOverlay,
      backgroundMusicSrc,
      backgroundMusicVolume,
    });

    return { id: job.id, status: job.status, isShort: body.isShort ?? null };
  }

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'voiceOver', maxCount: 1 },
        { name: 'backgroundMusicFile', maxCount: 1 },
        { name: 'images', maxCount: 200 },
        { name: 'textBackgroundVideos', maxCount: 200 },
      ],
      {
        // Intentionally use memory storage (no local disk writes).
        // Limits help avoid OOM/timeouts (especially on serverless platforms).
        limits: {
          files: 402,
          // Per-file size limit (bytes). Tune as needed for your typical inputs.
          fileSize: 50 * 1024 * 1024,
          fields: 70,
        },
      },
    ),
  )
  async create(
    @Body() body: CreateRenderVideoDto,
    @UploadedFiles()
    files: {
      voiceOver?: Multer.File[];
      backgroundMusicFile?: Multer.File[];
      images?: Multer.File[];
      textBackgroundVideos?: Multer.File[];
    },
  ) {
    // if (this.renderVideosService.isServerlessRuntime()) {
    //   throw new ServiceUnavailableException(
    //     'Video rendering jobs cannot run reliably on serverless runtimes when Cloudinary video uploads are disabled. Deploy the backend to a long-running server (Render/Railway/Fly).',
    //   );
    // }

    const voice = files.voiceOver?.[0];
    const backgroundMusicFile = files.backgroundMusicFile?.[0];
    const images = files.images ?? [];
    const textBackgroundVideos = files.textBackgroundVideos ?? [];
    const sentences = this.parseMultipartSentences(body);
    this.validateMultipartSentences(sentences, 1);
    const audioUrl = String(body.audioUrl ?? '').trim() || null;

    if (!voice?.buffer?.length && !audioUrl) {
      throw new BadRequestException('Missing `voiceOver` upload or `audioUrl`');
    }

    const alignedImages = this.alignUploadedImages(sentences, images);
    const alignedTextBackgroundVideos = this.alignUploadedTextBackgroundVideos(
      sentences,
      textBackgroundVideos,
    );
    const {
      audioDurationSeconds,
      useLowerFps,
      useLowerResolution,
      enableGlitchTransitions,
      enableLongFormSubscribeOverlay,
      addSubtitles,
      isShort,
      backgroundMusicSrc,
      backgroundMusicVolume,
    } = this.parseMultipartRenderOptions(body);

    const job = await this.renderVideosService.createJob({
      language:
        typeof body.language === 'string' ? body.language.trim() : undefined,
      audioFile: voice
        ? {
            buffer: voice.buffer,
            originalName: voice.originalname,
            mimeType: voice.mimetype,
          }
        : null,
      audioUrl,
      sentences,
      imageFiles: alignedImages.map((f) =>
        f
          ? {
              buffer: f.buffer,
              originalName: f.originalname,
              mimeType: f.mimetype,
            }
          : null,
      ),
      textBackgroundVideoFiles: alignedTextBackgroundVideos.map((file) =>
        file
          ? {
              buffer: file.buffer,
              originalName: file.originalname,
              mimeType: file.mimetype,
            }
          : null,
      ),
      scriptLength: body.scriptLength,
      audioDurationSeconds,
      isShort,
      useLowerFps,
      useLowerResolution,
      addSubtitles,
      enableGlitchTransitions,
      enableLongFormSubscribeOverlay,
      backgroundMusicFile: backgroundMusicFile
        ? {
            buffer: backgroundMusicFile.buffer,
            originalName: backgroundMusicFile.originalname,
            mimeType: backgroundMusicFile.mimetype,
          }
        : null,
      backgroundMusicSrc,
      backgroundMusicVolume,
    });

    return { id: job.id, status: job.status, isShort: isShort ?? null };
  }

  @Post('test')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'voiceOver', maxCount: 1 },
        { name: 'backgroundMusicFile', maxCount: 1 },
        { name: 'images', maxCount: 200 },
        { name: 'textBackgroundVideos', maxCount: 200 },
      ],
      {
        limits: {
          files: 402,
          fileSize: 50 * 1024 * 1024,
          fields: 80,
        },
      },
    ),
  )
  async createTestRender(
    @Body() body: CreateTestRenderVideoDto,
    @UploadedFiles()
    files: {
      voiceOver?: Multer.File[];
      backgroundMusicFile?: Multer.File[];
      images?: Multer.File[];
      textBackgroundVideos?: Multer.File[];
    },
  ) {
    // if (this.renderVideosService.isServerlessRuntime()) {
    //   throw new ServiceUnavailableException(
    //     'Video rendering jobs cannot run reliably on serverless runtimes when Cloudinary video uploads are disabled. Deploy the backend to a long-running server (Render/Railway/Fly).',
    //   );
    // }

    const voice = files.voiceOver?.[0];
    const backgroundMusicFile = files.backgroundMusicFile?.[0];
    const images = files.images ?? [];
    const textBackgroundVideos = files.textBackgroundVideos ?? [];
    const sentences = this.parseMultipartSentences(body);
    this.validateMultipartSentences(sentences, 2);

    const isSilent = body.isSilent === 'true';
    const audioUrl = String(body.audioUrl ?? '').trim() || null;
    if (!isSilent && !voice?.buffer?.length && !audioUrl) {
      throw new BadRequestException(
        'Missing `voiceOver` upload or `audioUrl` for non-silent test render',
      );
    }

    const alignedImages = this.alignUploadedImages(sentences, images);
    const alignedTextBackgroundVideos = this.alignUploadedTextBackgroundVideos(
      sentences,
      textBackgroundVideos,
    );
    const {
      audioDurationSeconds,
      useLowerFps,
      useLowerResolution,
      enableGlitchTransitions,
      enableLongFormSubscribeOverlay,
      addSubtitles,
      isShort,
      backgroundMusicSrc,
      backgroundMusicVolume,
    } = this.parseMultipartRenderOptions(body);

    const job = await this.renderVideosService.createJob({
      language:
        typeof body.language === 'string' ? body.language.trim() : undefined,
      audioFile: voice
        ? {
            buffer: voice.buffer,
            originalName: voice.originalname,
            mimeType: voice.mimetype,
          }
        : null,
      audioUrl,
      allowSilentAudio: isSilent,
      sentences,
      imageFiles: alignedImages.map((f) =>
        f
          ? {
              buffer: f.buffer,
              originalName: f.originalname,
              mimeType: f.mimetype,
            }
          : null,
      ),
      textBackgroundVideoFiles: alignedTextBackgroundVideos.map((file) =>
        file
          ? {
              buffer: file.buffer,
              originalName: file.originalname,
              mimeType: file.mimetype,
            }
          : null,
      ),
      scriptLength: body.scriptLength,
      audioDurationSeconds,
      isShort,
      useLowerFps,
      useLowerResolution,
      addSubtitles,
      enableGlitchTransitions,
      enableLongFormSubscribeOverlay,
      backgroundMusicFile: backgroundMusicFile
        ? {
            buffer: backgroundMusicFile.buffer,
            originalName: backgroundMusicFile.originalname,
            mimeType: backgroundMusicFile.mimetype,
          }
        : null,
      backgroundMusicSrc,
      backgroundMusicVolume,
    });

    return { id: job.id, status: job.status, isShort: isShort ?? null };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    ensureUuid(id);
    const job = await this.renderVideosService.getJob(id);
    await this.renderVideosService.failIfStale(job);
    const updated = await this.renderVideosService.getJob(id);
    const derivedIsShort =
      updated.timeline &&
      typeof updated.timeline.width === 'number' &&
      typeof updated.timeline.height === 'number'
        ? updated.timeline.height > updated.timeline.width
        : null;
    return {
      id: updated.id,
      status: updated.status,
      error: updated.error,
      videoUrl: updated.videoPath ? updated.videoPath : null,
      timeline: updated.timeline,
      isShort: derivedIsShort,
      lastProgressAt: updated.lastProgressAt ?? null,
      updatedAt: (updated as any).updatedAt ?? null,
      createdAt: (updated as any).createdAt ?? null,
    };
  }
}
