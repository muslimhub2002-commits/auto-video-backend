import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { UpdateScriptDto } from './dto/update-script.dto';

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

  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() updateScriptDto: UpdateScriptDto,
  ) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.scriptsService.update(id, user_id, updateScriptDto);
  }

  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.scriptsService.remove(id, user_id);
  }
}
