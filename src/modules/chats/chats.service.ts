import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Chat } from './entities/chat.entity';
import { Message } from '../messages/entities/message.entity';

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
      ],
    });

    return { chat, messages };
  }
}
