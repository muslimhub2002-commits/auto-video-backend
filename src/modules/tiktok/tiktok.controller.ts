import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import { TiktokUploadDto } from './dto/tiktok-upload.dto';
import { TiktokService } from './tiktok.service';

@Controller('tiktok')
export class TiktokController {
  constructor(private readonly tiktokService: TiktokService) {}

  @UseGuards(JwtAuthGuard)
  @Get('auth-url')
  async getAuthUrl(
    @Req() req: Request,
    @GetUser() user: User,
    @Query('socialAccountId') socialAccountId?: string,
  ) {
    const host = req.get('host');
    const hostname = (host ?? '').split(':')[0].replace(/^\[|\]$/g, '');
    const isLocalhost =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1';
    const redirectUriOverride =
      isLocalhost && host
        ? `${req.protocol}://${host}/tiktok/oauth2callback`
        : undefined;

    const url = await this.tiktokService.getAuthUrl(
      user,
      redirectUriOverride,
      socialAccountId,
    );
    return { url };
  }

  @Get('oauth2callback')
  async oauth2callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
  ) {
    const host = req.get('host');
    const hostname = (host ?? '').split(':')[0].replace(/^\[|\]$/g, '');
    const isLocalhost =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1';
    const redirectUriOverride =
      isLocalhost && host
        ? `${req.protocol}://${host}/tiktok/oauth2callback`
        : undefined;

    await this.tiktokService.handleOAuthCallback({
      code,
      state,
      redirectUriOverride,
    });

    res
      .status(200)
      .type('html')
      .send(
        `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>TikTok Connected</title></head><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px;"><h2 style="margin:0 0 8px;">TikTok connected</h2><p style="margin:0 0 16px;color:#555;">You can close this tab and return to the app.</p><script>try{if(window.opener){window.opener.postMessage({source:'tiktok-oauth',success:true},'*');}}catch(e){}setTimeout(function(){window.close();},300);</script></body></html>`,
      );
  }

  @UseGuards(JwtAuthGuard)
  @Get('creator-info')
  async getCreatorInfo(
    @GetUser() user: User,
    @Query('socialAccountId') socialAccountId?: string,
  ) {
    return this.tiktokService.getCreatorInfo(user, socialAccountId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('status')
  async getStatus(@GetUser() user: User) {
    return this.tiktokService.getConnectionStatus(user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  async upload(@GetUser() user: User, @Body() body: TiktokUploadDto) {
    return this.tiktokService.uploadVideo(user, body);
  }
}
