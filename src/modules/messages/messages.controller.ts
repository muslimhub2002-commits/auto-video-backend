import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MessagesService } from './messages.service';
import { SaveGenerationDto } from './dto/save-generation.dto';

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post('save-generation')
  @HttpCode(200)
  async saveGeneration(@Req() req: Request, @Body() body: SaveGenerationDto) {
    const user = (req as any).user;
    const user_id = user?.id;

    return this.messagesService.saveGeneration(user_id, body);
  }
}
