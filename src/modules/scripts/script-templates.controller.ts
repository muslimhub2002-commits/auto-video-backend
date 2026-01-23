import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ScriptTemplatesService } from './script-templates.service';
import { CreateScriptTemplateDto } from './dto/create-script-template.dto';
import { UpdateScriptTemplateDto } from './dto/update-script-template.dto';

@Controller('script-templates')
@UseGuards(JwtAuthGuard)
export class ScriptTemplatesController {
  constructor(private readonly templatesService: ScriptTemplatesService) {}

  @Post()
  async create(@Req() req: Request, @Body() dto: CreateScriptTemplateDto) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) throw new UnauthorizedException('User not found in request');

    return this.templatesService.create(user_id, dto);
  }

  @Get()
  async findAll(
    @Req() req: Request,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) throw new UnauthorizedException('User not found in request');

    const pageNum = Number.parseInt(page, 10) || 1;
    const limitNum = Number.parseInt(limit, 10) || 20;

    return this.templatesService.findAllByUser(user_id, pageNum, limitNum);
  }

  @Get(':id')
  async findOne(@Req() req: Request, @Param('id') id: string) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) throw new UnauthorizedException('User not found in request');

    return this.templatesService.findOne(id, user_id);
  }

  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateScriptTemplateDto,
  ) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) throw new UnauthorizedException('User not found in request');

    return this.templatesService.update(id, user_id, dto);
  }

  @Delete(':id')
  async remove(@Req() req: Request, @Param('id') id: string) {
    const user = (req as any).user;
    const user_id = user?.id;

    if (!user_id) throw new UnauthorizedException('User not found in request');

    return this.templatesService.remove(id, user_id);
  }
}
