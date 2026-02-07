import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChatsService } from './chats.service';

@Controller('chats')
@UseGuards(JwtAuthGuard)
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Get()
  async findUserChats(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const user = (req as any).user;
    const user_id = user?.id;

    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;

    return this.chatsService.findUserChats(user_id, pageNum, limitNum);
  }

  @Get(':id/messages')
  async getChatMessages(@Req() req: Request, @Param('id') id: string) {
    const user = (req as any).user;
    const user_id = user?.id;

    return this.chatsService.getChatMessages(id, user_id);
  }

  @Delete(':id')
  async deleteChat(@Req() req: Request, @Param('id') id: string) {
    const user = (req as any).user;
    const user_id = user?.id;

    await this.chatsService.deleteChat(id, user_id);
    return { ok: true };
  }
}
