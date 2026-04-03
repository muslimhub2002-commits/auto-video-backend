import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import { ExchangeMetaTokenDto } from './dto/exchange-meta-token.dto';
import { MetaUploadDto } from './dto/meta-upload.dto';
import { UpsertMetaCredentialsDto } from './dto/upsert-meta-credentials.dto';
import { MetaCredentialsService } from './meta-credentials.service';
import { MetaService } from './meta.service';

@Controller('meta')
export class MetaController {
  constructor(
    private readonly metaCredentialsService: MetaCredentialsService,
    private readonly metaService: MetaService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('credentials')
  async getCredentials() {
    return this.metaCredentialsService.getSharedCredentialsStatus();
  }

  @UseGuards(JwtAuthGuard)
  @Post('credentials')
  async upsertCredentials(
    @GetUser() user: User,
    @Body() body: UpsertMetaCredentialsDto,
  ) {
    return this.metaCredentialsService.upsertSharedCredentials(user, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('credentials/refresh')
  async refreshCredentials(@GetUser() user: User) {
    return this.metaCredentialsService.refreshSharedCredentials(user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('credentials/exchange-token')
  async exchangeToken(@GetUser() user: User, @Body() body: ExchangeMetaTokenDto) {
    return this.metaCredentialsService.exchangeToken(user, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  async upload(@GetUser() user: User, @Body() body: MetaUploadDto) {
    return this.metaService.uploadVideo(user, body);
  }
}