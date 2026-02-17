import { Injectable } from '@nestjs/common';
import { GenerateScriptDto } from './dto/generate-script.dto';
import { EnhanceScriptDto } from './dto/enhance-script.dto';
import { EnhanceSentenceDto } from './dto/enhance-sentence.dto';
import { GenerateImageDto } from './dto/generate-image.dto';
import { GenerateVideoFromFramesDto } from './dto/generate-video-from-frames.dto';
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
    options?: { useWebSearch?: boolean },
  ): Promise<{ title: string; description: string; tags: string[] }> {
    return this.youtubeService.generateYoutubeSeo(script, options);
  }

  generateImageForSentence(dto: GenerateImageDto, userId: string) {
    return this.imageService.generateImageForSentence(dto, userId);
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
