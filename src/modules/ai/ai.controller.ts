import {
  Body,
  Controller,
  Post,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { AiService } from './ai.service';
import { GenerateScriptDto } from './dto/generate-script.dto';
import { SplitScriptDto } from './dto/split-script.dto';
import { GenerateImageDto } from './dto/generate-image.dto';
import { GenerateVoiceDto } from './dto/generate-voice.dto';
import { EnhanceScriptDto } from './dto/enhance-script.dto';
import { YoutubeSeoDto } from './dto/youtube-seo.dto';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * Streams a randomly generated script from OpenAI.
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
      // OpenAI stream is an async iterable of ChatCompletionChunk objects

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          res.write(content);
        }
      }
      res.end();
    } catch (error) {
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
      // OpenAI stream is an async iterable of ChatCompletionChunk objects

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          res.write(content);
        }
      }
      res.end();
    } catch (error) {
      // If something goes wrong during streaming, end the response gracefully
      if (!res.headersSent) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR);
      }
      res.end('\n[Error] Failed to stream enhanced script.');
    }
  }

  /**
   * Generates an image (and its prompt) for a single sentence.
   */
  @Post('generate-image-from-sentence')
  @HttpCode(HttpStatus.OK)
  async generateImageFromSentence(@Body() body: GenerateImageDto) {
    const result = await this.aiService.generateImageForSentence(body);
    return result;
  }

  /**
   * Generates a voice-over audio clip (MP3) for the given script using ElevenLabs.
   */
  @Post('generate-voice')
  @HttpCode(HttpStatus.OK)
  async generateVoice(
    @Body() body: GenerateVoiceDto,
    @Res() res: Response,
  ): Promise<void> {
    const audioBuffer = await this.aiService.generateVoiceForScript(
      body.script,
      body.voiceId,
    );

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader(
      'Content-Disposition',
      'inline; filename="voice-over-elevenlabs.mp3"',
    );
    res.send(audioBuffer);
  }

  @Post('youtube-seo')
  @HttpCode(HttpStatus.OK)
  async youtubeSeo(@Body() body: YoutubeSeoDto) {
    const result = await this.aiService.generateYoutubeSeo(body.script);
    return result;
  }
}
