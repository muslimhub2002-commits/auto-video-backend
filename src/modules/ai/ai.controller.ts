import {
  Body,
  UseInterceptors,
  UploadedFiles,
  Controller,
  Post,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { AiService } from './ai.service';
import { GenerateScriptDto } from './dto/generate-script.dto';
import { SplitScriptDto } from './dto/split-script.dto';
import { GenerateImageDto } from './dto/generate-image.dto';
import { GenerateVoiceDto } from './dto/generate-voice.dto';
import { EnhanceScriptDto } from './dto/enhance-script.dto';
import { EnhanceSentenceDto } from './dto/enhance-sentence.dto';
import { YoutubeSeoDto } from './dto/youtube-seo.dto';
import { GenerateVideoFromFramesDto } from './dto/generate-video-from-frames.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { User } from '../users/entities/user.entity';

type UploadedImageFile = {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
};

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * Streams a randomly generated script from the selected model/provider.
   * Response is plain text streamed in small chunks.
   */
  @Post('generate-script')
  @HttpCode(HttpStatus.OK)
  async generateScript(
    @Body() body: GenerateScriptDto,
    @Res() res: Response,
  ): Promise<void> {
    // Configure streaming response
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    const stream = await this.aiService.createScriptStream(body);

    try {
      for await (const chunk of stream) {
        if (chunk) res.write(chunk);
      }
      res.end();
    } catch (error) {
      console.error('Error streaming /ai/generate-script:', error);
      // If something goes wrong during streaming, end the response gracefully
      if (!res.headersSent) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR);
      }
      res.end('\n[Error] Failed to stream script.');
    }
  }

  /**
   * Splits an existing script into small sentences.
   */
  @Post('split-script')
  @HttpCode(HttpStatus.OK)
  async splitScript(@Body() body: SplitScriptDto) {
    const sentences = await this.aiService.splitScript(body);
    return { sentences };
  }

  /**
   * Enhances an existing script by refining clarity, flow, and engagement.
   */
  @Post('enhance-script')
  @HttpCode(HttpStatus.OK)
  async enhanceScript(
    @Body() body: EnhanceScriptDto,
    @Res() res: Response,
  ): Promise<void> {
    // Configure streaming response
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    const stream = await this.aiService.createEnhanceScriptStream(body);

    try {
      for await (const chunk of stream) {
        if (chunk) res.write(chunk);
      }
      res.end();
    } catch (error) {
      console.error('Error streaming /ai/enhance-script:', error);
      // If something goes wrong during streaming, end the response gracefully
      if (!res.headersSent) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR);
      }
      res.end('\n[Error] Failed to stream enhanced script.');
    }
  }

  /**
   * Enhances a single sentence (rewrite) while preserving meaning.
   * Streams plain text in small chunks.
   */
  @Post('enhance-sentence')
  @HttpCode(HttpStatus.OK)
  async enhanceSentence(
    @Body() body: EnhanceSentenceDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    const stream = await this.aiService.createEnhanceSentenceStream(body);

    try {
      for await (const chunk of stream) {
        if (chunk) res.write(chunk);
      }
      res.end();
    } catch (error) {
      console.error('Error streaming /ai/enhance-sentence:', error);
      if (!res.headersSent) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR);
      }
      res.end('\n[Error] Failed to stream enhanced sentence.');
    }
  }

  /**
   * Generates an image (and its prompt) for a single sentence.
   */
  @Post('generate-image-from-sentence')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async generateImageFromSentence(
    @GetUser() user: User,
    @Body() body: GenerateImageDto,
  ) {
    const result = await this.aiService.generateImageForSentence(body, user.id);
    return result;
  }

  /**
   * Generates a short video clip from 1-2 image frames.
   * This endpoint does not persist scripts/sentences/videos in the DB.
   */
  @Post('generate-video-from-frames')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'startFrame', maxCount: 1 },
        { name: 'endFrame', maxCount: 1 },
      ],
      {
        limits: {
          fileSize: 12 * 1024 * 1024,
          files: 2,
        },
      },
    ),
  )
  async generateVideoFromFrames(
    @GetUser() user: User,
    @Body() body: GenerateVideoFromFramesDto,
    @UploadedFiles()
    files: {
      startFrame?: UploadedImageFile[];
      endFrame?: UploadedImageFile[];
    },
  ) {
    const startFrameFile = files?.startFrame?.[0];
    const endFrameFile = files?.endFrame?.[0];

    const result = await this.aiService.generateVideoFromUploadedFrames({
      userId: user.id,
      dto: body,
      startFrameFile,
      endFrameFile,
    });

    return result;
  }

  /**
   * Generates a voice-over audio clip.
   * - ElevenLabs: MP3
   * - AI Studio (Gemini TTS): MP3
   */
  @Post('generate-voice')
  @HttpCode(HttpStatus.OK)
  async generateVoice(
    @Body() body: GenerateVoiceDto,
    @Res() res: Response,
  ): Promise<void> {
    const hasSentences =
      Array.isArray(body.sentences) && body.sentences.length > 0;
    const result = hasSentences
      ? await this.aiService.generateVoiceForSentences(
          body.sentences!,
          body.voiceId,
          body.styleInstructions,
        )
      : await this.aiService.generateVoiceForScript(
          body.script,
          body.voiceId,
          body.styleInstructions,
        );

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${result.filename}"`,
    );
    res.send(result.buffer);
  }

  @Post('youtube-seo')
  @HttpCode(HttpStatus.OK)
  async youtubeSeo(@Body() body: YoutubeSeoDto) {
    const result = await this.aiService.generateYoutubeSeo(body.script);
    return result;
  }
}
