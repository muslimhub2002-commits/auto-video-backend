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
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateSavedSequenceDto } from './dto/create-saved-sequence.dto';
import { UpdateSavedSequenceDto } from './dto/update-saved-sequence.dto';
import { SavedSequencesService } from './saved-sequences.service';

@Controller('saved-sequences')
@UseGuards(JwtAuthGuard)
export class SavedSequencesController {
  constructor(private readonly service: SavedSequencesService) {}

  @Get()
  async findAll(
    @Req() req: Request,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
    @Query('q') q: string = '',
  ) {
    const user_id = (req as any).user?.id;
    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.service.findAllByUser(
      user_id,
      Number.parseInt(page, 10) || 1,
      Number.parseInt(limit, 10) || 20,
      q,
    );
  }

  @Get(':savedSequenceId')
  async findOne(
    @Req() req: Request,
    @Param('savedSequenceId') savedSequenceId: string,
  ) {
    const user_id = (req as any).user?.id;
    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.service.findOneByUser({ user_id, savedSequenceId });
  }

  @Post()
  async create(@Req() req: Request, @Body() body: CreateSavedSequenceDto) {
    const user_id = (req as any).user?.id;
    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.service.create(user_id, body);
  }

  @Patch(':savedSequenceId')
  async update(
    @Req() req: Request,
    @Param('savedSequenceId') savedSequenceId: string,
    @Body() body: UpdateSavedSequenceDto,
  ) {
    const user_id = (req as any).user?.id;
    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.service.update({
      user_id,
      savedSequenceId,
      dto: body,
    });
  }

  @Delete(':savedSequenceId')
  async remove(
    @Req() req: Request,
    @Param('savedSequenceId') savedSequenceId: string,
  ) {
    const user_id = (req as any).user?.id;
    if (!user_id) {
      throw new UnauthorizedException('User not found in request');
    }

    return this.service.remove({ user_id, savedSequenceId });
  }
}