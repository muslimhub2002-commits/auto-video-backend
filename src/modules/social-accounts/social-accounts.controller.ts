import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import { CreateSocialAccountDto } from './dto/create-social-account.dto';
import { UpdateSocialAccountDto } from './dto/update-social-account.dto';
import { SocialAccountsService } from './social-accounts.service';

@Controller('social-accounts')
@UseGuards(JwtAuthGuard)
export class SocialAccountsController {
  constructor(private readonly socialAccountsService: SocialAccountsService) {}

  @Get()
  async list(@GetUser() user: User) {
    return this.socialAccountsService.list(user.id);
  }

  @Get(':provider')
  async getProvider(@GetUser() user: User, @Param('provider') provider: string) {
    return this.socialAccountsService.getProvider(user.id, provider);
  }

  @Get(':provider/accounts/:accountId')
  async getAccount(
    @GetUser() user: User,
    @Param('provider') provider: string,
    @Param('accountId') accountId: string,
  ) {
    return this.socialAccountsService.getAccount(user.id, provider, accountId);
  }

  @Post(':provider/accounts')
  async create(
    @GetUser() user: User,
    @Param('provider') provider: string,
    @Body() body: CreateSocialAccountDto,
  ) {
    return this.socialAccountsService.create(user.id, provider, body);
  }

  @Patch(':provider/accounts/:accountId')
  async update(
    @GetUser() user: User,
    @Param('provider') provider: string,
    @Param('accountId') accountId: string,
    @Body() body: UpdateSocialAccountDto,
  ) {
    return this.socialAccountsService.update(user.id, provider, accountId, body);
  }

  @Patch(':provider/accounts/:accountId/default')
  async setDefault(
    @GetUser() user: User,
    @Param('provider') provider: string,
    @Param('accountId') accountId: string,
  ) {
    return this.socialAccountsService.setDefault(user.id, provider, accountId);
  }

  @Delete(':provider/accounts/:accountId')
  async remove(
    @GetUser() user: User,
    @Param('provider') provider: string,
    @Param('accountId') accountId: string,
  ) {
    return this.socialAccountsService.remove(user.id, provider, accountId);
  }
}