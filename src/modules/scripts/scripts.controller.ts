import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  UnauthorizedException,
  Query,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ScriptsService } from './scripts.service';
import { CreateScriptDto } from './dto/create-script.dto';

@Controller('scripts')
@UseGuards(JwtAuthGuard)
export class ScriptsController {
  constructor(private readonly scriptsService: ScriptsService) {}

  @Post()
  async create(@Req() req: Request, @Body() createScriptDto: CreateScriptDto) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.scriptsService.create(user_id, createScriptDto);
  }

  @Get()
  async findAll(
    @Req() req: Request,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    const pageNum = Number.parseInt(page, 10) || 1;
    const limitNum = Number.parseInt(limit, 10) || 20;

    return this.scriptsService.findAllByUser(user_id, pageNum, limitNum);
  }
}
