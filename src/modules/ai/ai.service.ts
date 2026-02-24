import { Injectable } from '@nestjs/common';
import { GenerateScriptDto } from './dto/generate-script.dto';
import { EnhanceScriptDto } from './dto/enhance-script.dto';
import { EnhanceSentenceDto } from './dto/enhance-sentence.dto';
import { GenerateImageDto } from './dto/generate-image.dto';
import { YoutubeWallpaperDto } from './dto/youtube-wallpaper.dto';
import { GenerateVideoFromFramesDto } from './dto/generate-video-from-frames.dto';
import { GenerateVideoFromTextDto } from './dto/generate-video-from-text.dto';
import { GenerateVideoFromReferenceImageDto } from './dto/generate-video-from-reference-image.dto';
import { AiTextService } from './services/ai-text.service';
import { AiImageService } from './services/ai-image.service';
import { AiVoiceService } from './services/ai-voice.service';
import { AiVideoService } from './services/ai-video.service';
import { AiYoutubeService } from './services/ai-youtube.service';

@Injectable()
export class AiService {
  constructor(
    private readonly textService: AiTextService,
    private readonly youtubeService: AiYoutubeService,
    private readonly imageService: AiImageService,
    private readonly voiceService: AiVoiceService,
    private readonly videoService: AiVideoService,
  ) {}

  generateVideoFromFrames(params: {
    prompt: string;
    model?: string;
    resolution?: string;
    aspectRatio?: string;
    isLooping?: boolean;
    startFrame: { buffer: Buffer; mimeType: string };
    endFrame?: { buffer: Buffer; mimeType: string };
  }): Promise<{ buffer: Buffer; mimeType: string; uri: string }> {
    return this.videoService.generateVideoFromFrames(params);
  }

  generateVideoFromUploadedFrames(params: {
    userId: string;
    dto: GenerateVideoFromFramesDto;
    startFrameFile?: {
      buffer?: Buffer;
      mimetype?: string;
      size?: number;
      originalname?: string;
    };
    endFrameFile?: {
      buffer?: Buffer;
      mimetype?: string;
      size?: number;
      originalname?: string;
    };
  }): Promise<{ videoUrl: string }> {
    return this.videoService.generateVideoFromUploadedFrames(params);
  }

  generateVideoFromText(params: {
    userId: string;
    dto: GenerateVideoFromTextDto;
  }): Promise<{ videoUrl: string }> {
    return this.videoService.generateVideoFromText(params);
  }

  generateVideoFromUploadedReferenceImage(params: {
    userId: string;
    dto: GenerateVideoFromReferenceImageDto;
    referenceImageFile?: {
      buffer?: Buffer;
      mimetype?: string;
      size?: number;
      originalname?: string;
    };
  }): Promise<{ videoUrl: string }> {
    return this.videoService.generateVideoFromUploadedReferenceImage(params);
  }

  listGoogleModels(params?: { query?: string }): Promise<{ models: any[] }> {
    return this.videoService.listGoogleModels(params);
  }

  createScriptStream(options: GenerateScriptDto) {
    return this.textService.createScriptStream(options);
  }

  splitScript(dto: {
    script: string;
    model?: string;
    systemPrompt?: string;
  }): Promise<{
    sentences: string[];
    characters: Array<{
      key: string;
      name: string;
      description: string;
      isSahaba: boolean;
      isProphet: boolean;
      isWoman: boolean;
    }>;
  }> {
    return this.textService.splitScript(dto);
  }

  createEnhanceScriptStream(dto: EnhanceScriptDto) {
    return this.textService.createEnhanceScriptStream(dto);
  }

  createEnhanceSentenceStream(dto: EnhanceSentenceDto) {
    return this.textService.createEnhanceSentenceStream(dto);
  }

  createVoiceStyleInstructionsStream(dto: { script: string; model?: string }) {
    return this.textService.createVoiceStyleInstructionsStream(dto);
  }

  generateTitleForScript(script: string): Promise<string> {
    return this.textService.generateTitleForScript(script);
  }

  generateYoutubeSeo(
    script: string,
    options?: { useWebSearch?: boolean; isShort?: boolean },
  ): Promise<{ title: string; description: string; tags: string[] }> {
    return this.youtubeService.generateYoutubeSeo(script, options);
  }

  generateImageForSentence(dto: GenerateImageDto, userId: string) {
    return this.imageService.generateImageForSentence(dto, userId);
  }

  async generateYoutubeWallpaper(dto: YoutubeWallpaperDto, userId: string) {
    const script = String(dto?.script ?? '').trim();
    const title = String(dto?.title ?? '').trim();

    const canonicalCharacters = Array.isArray(dto?.characters)
      ? dto.characters
      : [];

    // Filter ONLY non-Prophet, non-Sahaba, non-women characters as requested.
    const safeCharacters = canonicalCharacters
      .filter((c) => !c.isProphet && !c.isSahaba && !c.isWoman)
      .map((c) => ({
        key: String(c.key ?? '').trim(),
        name: String(c.name ?? '').trim(),
        description: String(c.description ?? '').trim(),
      }))
      .filter((c) => c.key && c.name && c.description);

    const wallpaper = await this.youtubeService.generateYoutubeWallpaperPrompt({
      script,
      title: title || undefined,
      promptModel: dto.promptModel,
      safeCharacters,
    });

    const style = String(dto?.style ?? '').trim() || 'Cinematic, ultra-detailed, high contrast, high quality';

    const imageResult = await this.imageService.generateImageForSentence(
      {
        sentence: 'YouTube wallpaper',
        script,
        prompt: `${wallpaper.prompt}\n\nHeadline text: "${wallpaper.headline}"`,
        style,
        isShort: false,
        imageModel: dto.imageModel,
        characters: canonicalCharacters.length ? canonicalCharacters : undefined,
        forcedCharacterKeys: wallpaper.characterKeys.length
          ? wallpaper.characterKeys
          : undefined,
        allowText: true,
      },
      userId,
    );

    return {
      headline: wallpaper.headline,
      usedCharacterKeys: wallpaper.characterKeys,
      safeCharacters,
      prompt: imageResult?.prompt,
      imageUrl: (imageResult as any)?.imageUrl,
      imageBase64: (imageResult as any)?.imageBase64,
      savedImageId: (imageResult as any)?.savedImageId,
    };
  }

  generateVoiceForSentences(
    sentences: string[],
    voiceId?: string,
    styleInstructions?: string,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    return this.voiceService.generateVoiceForSentences(
      sentences,
      voiceId,
      styleInstructions,
    );
  }

  generateVoiceForScript(
    script: string,
    voiceId?: string,
    styleInstructions?: string,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    return this.voiceService.generateVoiceForScript(
      script,
      voiceId,
      styleInstructions,
    );
  }
}
