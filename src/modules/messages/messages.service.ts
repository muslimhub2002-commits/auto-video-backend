import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Chat } from '../chats/entities/chat.entity';
import { Message } from './entities/message.entity';
import { Video } from '../videos/entities/video.entity';
import { SaveGenerationDto } from './dto/save-generation.dto';
import { AiService } from '../ai/ai.service';
import { ScriptsService } from '../scripts/scripts.service';
import { RenderVideosService } from '../render-videos/render-videos.service';
import { v2 as cloudinary } from 'cloudinary';
import * as fs from 'fs';

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Chat)
    private readonly chatRepository: Repository<Chat>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly renderVideosService: RenderVideosService,
    private readonly aiService: AiService,
    private readonly scriptsService: ScriptsService,
  ) {}

  async saveGeneration(userId: string, dto: SaveGenerationDto) {
    const { script, sentences, video_url, voice_id, chat_id } = dto;

    const trimmedScript = (script ?? '').trim();
    const [existingScript, existingVideo] = await Promise.all([
      this.scriptsService.findByScriptText(userId, trimmedScript),
      this.videoRepository.findOne({
        where: {
          user_id: userId,
          video: video_url,
        },
      }),
    ]);

    if (existingScript?.message_id) {
      const existingMessage = await this.messageRepository.findOne({
        where: { id: existingScript.message_id },
        select: { id: true, chat_id: true },
      });

      return {
        chat_id: existingMessage?.chat_id ?? null,
        message_id: existingMessage?.id ?? existingScript.message_id,
        already_saved: true,
        reason: 'script',
      };
    }

    if (existingScript) {
      return {
        chat_id: null,
        message_id: null,
        already_saved: true,
        reason: 'script',
      };
    }

    if (existingVideo?.id) {
      const existingMessage = await this.messageRepository.findOne({
        where: { video_id: existingVideo.id },
        select: { id: true, chat_id: true },
      });

      return {
        chat_id: existingMessage?.chat_id ?? null,
        message_id: existingMessage?.id ?? null,
        already_saved: true,
        reason: 'video',
      };
    }

    let finalVideoUrl = video_url;

    // Derive the render job id from the local video URL so we can
    // locate the rendered file on disk and upload it to Cloudinary
    // only when the user explicitly saves the generation.
    const jobIdFromUrl = this.extractJobIdFromVideoUrl(video_url);

    if (jobIdFromUrl) {
      const hasCloudinary =
        !!process.env.CLOUDINARY_CLOUD_NAME &&
        !!process.env.CLOUDINARY_API_KEY &&
        !!process.env.CLOUDINARY_CLOUD_SECRET;

      const localPath = this.renderVideosService.getVideoFsPath(jobIdFromUrl);

      if (hasCloudinary && fs.existsSync(localPath)) {
        cloudinary.config({
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          api_key: process.env.CLOUDINARY_API_KEY,
          api_secret: process.env.CLOUDINARY_CLOUD_SECRET,
        });

        try {
          const uploadResult: any = await cloudinary.uploader.upload(localPath, {
            folder: 'auto-video-generator/videos',
            resource_type: 'video',
            overwrite: false,
            use_filename: false,
          });

          if (uploadResult?.secure_url) {
            finalVideoUrl = uploadResult.secure_url as string;
          }
        } catch (e) {
          // Graceful fallback: keep original local/served URL
        }
      }
      // else: missing Cloudinary config or file not found — keep original URL
    }

    const title = await this.aiService.generateTitleForScript(trimmedScript);

    let targetChat: Chat;

    if (chat_id) {
      // Reuse an existing chat for this user so multiple generations
      // can be grouped under the same conversation.
      const existingChat = await this.chatRepository.findOne({
        where: { id: chat_id, user_id: userId },
      });

      if (!existingChat) {
        // If the provided chat does not exist or doesn't belong to the user,
        // fall back to creating a new chat.
        targetChat = this.chatRepository.create({
          user_id: userId,
          title: title || null,
        });
        targetChat = await this.chatRepository.save(targetChat);
      } else {
        targetChat = existingChat;
      }
    } else {
      // No chat specified: create a new one as before.
      targetChat = this.chatRepository.create({
        user_id: userId,
        title: title || null,
      });
      targetChat = await this.chatRepository.save(targetChat);
    }

    const video = this.videoRepository.create({
      video: finalVideoUrl,
      user_id: userId,
    });
    const savedVideo = await this.videoRepository.save(video);

    const message = this.messageRepository.create({
      chat_id: targetChat.id,
      video_id: savedVideo.id ?? undefined,
      voice_id: voice_id ?? undefined,
    });
    const savedMessage = await this.messageRepository.save(message);

    if (sentences && sentences.length > 0) {
      await this.scriptsService.create(userId, {
        script: trimmedScript,
        message_id: savedMessage.id,
        sentences,
        title,
      });
    }

    return {
      chat_id: targetChat.id,
      message_id: savedMessage.id,
    };
  }

  private extractJobIdFromVideoUrl(videoUrl: string): string | null {
    try {
      const url = new URL(videoUrl);
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments.length === 0) return null;
      const fileName = segments[segments.length - 1];
      const dotIndex = fileName.lastIndexOf('.');
      if (dotIndex <= 0) return null;
      return fileName.substring(0, dotIndex);
    } catch {
      return null;
    }
  }
}
