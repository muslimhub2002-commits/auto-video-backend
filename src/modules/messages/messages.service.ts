import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Chat } from '../chats/entities/chat.entity';
import { Message } from './entities/message.entity';
import { Video } from '../videos/entities/video.entity';
import { SaveGenerationDto } from './dto/save-generation.dto';
import { AiService } from '../ai/ai.service';
import { ScriptsService } from '../scripts/scripts.service';

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Chat)
    private readonly chatRepository: Repository<Chat>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly aiService: AiService,
    private readonly scriptsService: ScriptsService,
  ) {}

  async saveGeneration(userId: string, dto: SaveGenerationDto) {
    const {
      script,
      sentences,
      video_url,
      voice_id,
      chat_id,
      subject,
      subject_content,
      length,
      style,
      reference_script_ids,
      technique,
    } = dto;

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

    // Cloudinary video uploads are disabled; keep the provided video URL.

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
        subject,
        subject_content,
        length,
        style,
        reference_script_ids,
        technique,
      });
    }

    return {
      chat_id: targetChat.id,
      message_id: savedMessage.id,
    };
  }

}
