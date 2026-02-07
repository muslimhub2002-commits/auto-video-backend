import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Chat } from './entities/chat.entity';
import { Message } from '../messages/entities/message.entity';
import { Script } from '../scripts/entities/script.entity';
import { Sentence } from '../scripts/entities/sentence.entity';
import { Image } from '../images/entities/image.entity';
import { Video } from '../videos/entities/video.entity';

@Injectable()
export class ChatsService {
  constructor(
    @InjectRepository(Chat)
    private readonly chatRepository: Repository<Chat>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
  ) {}

  async findUserChats(userId: string, page = 1, limit = 20) {
    const take = Math.min(limit || 20, 50);
    const skip = (page - 1) * take;

    const [items, total] = await this.chatRepository.findAndCount({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
      skip,
      take,
    });

    return {
      items,
      total,
      page,
      limit: take,
    };
  }

  async getChatMessages(chatId: string, userId: string) {
    const chat = await this.chatRepository.findOne({
      where: { id: chatId, user_id: userId },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    const messages = await this.messageRepository.find({
      where: { chat_id: chat.id },
      order: { created_at: 'ASC' },
      relations: [
        'video',
        'voice',
        'scripts',
        'scripts.sentences',
        'scripts.sentences.image',
        'scripts.sentences.startFrameImage',
        'scripts.sentences.endFrameImage',
        'scripts.sentences.video',
      ],
    });

    return { chat, messages };
  }

  async deleteChat(chatId: string, userId: string) {
    const chat = await this.chatRepository.findOne({
      where: { id: chatId, user_id: userId },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    await this.chatRepository.manager.transaction(async (manager) => {
      const messageRepo = manager.getRepository(Message);
      const scriptRepo = manager.getRepository(Script);
      const sentenceRepo = manager.getRepository(Sentence);
      const imageRepo = manager.getRepository(Image);
      const videoRepo = manager.getRepository(Video);
      const chatRepo = manager.getRepository(Chat);

      const messages = await messageRepo.find({
        where: { chat_id: chatId },
        select: {
          id: true,
          video_id: true,
        } as any,
      });

      const messageIds = messages.map((m) => m.id);
      const videoIds = messages
        .map((m) => m.video_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);

      if (messageIds.length > 0) {
        const scripts = await scriptRepo.find({
          where: { message_id: In(messageIds) },
          select: { id: true } as any,
        });

        const scriptIds = scripts.map((s) => s.id);

        if (scriptIds.length > 0) {
          await sentenceRepo
            .createQueryBuilder()
            .delete()
            .where('script_id IN (:...scriptIds)', { scriptIds })
            .execute();

          await scriptRepo
            .createQueryBuilder()
            .delete()
            .where('id IN (:...scriptIds)', { scriptIds })
            .execute();
        }

        await imageRepo
          .createQueryBuilder()
          .delete()
          .where('message_id IN (:...messageIds)', { messageIds })
          .execute();

        await messageRepo
          .createQueryBuilder()
          .delete()
          .where('id IN (:...messageIds)', { messageIds })
          .execute();

        if (videoIds.length > 0) {
          await videoRepo
            .createQueryBuilder()
            .delete()
            .where('id IN (:...videoIds)', { videoIds })
            .andWhere('user_id = :userId', { userId })
            .execute();
        }
      }

      await chatRepo.delete({ id: chatId, user_id: userId });
    });
  }
}
