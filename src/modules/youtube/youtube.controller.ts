import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { User } from '../users/entities/user.entity';
import { YoutubeService } from './youtube.service';
import { YoutubeUploadDto } from './dto/youtube-upload.dto';

@Controller('youtube')
export class YoutubeController {
  constructor(private readonly youtubeService: YoutubeService) {}

  @UseGuards(JwtAuthGuard)
  @Get('auth-url')
  async getAuthUrl(@Req() req: Request, @GetUser() user: User) {
    // In local/dev, users frequently run the backend locally while keeping
    // a production YOUTUBE_REDIRECT_URI in `.env`. That causes the OAuth
    // callback (and token storage) to happen on the wrong server.
    // Derive the redirect URI from the current request in non-production.
    const host = req.get('host');
    const hostname = (host ?? '').split(':')[0].replace(/^\[|\]$/g, '');
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    const redirectUriOverride = isLocalhost && host
      ? `${req.protocol}://${host}/youtube/oauth2callback`
      : undefined;

    const url = this.youtubeService.getAuthUrl(user.id, redirectUriOverride);
    return { url };
  }

  // Google redirects here after user consent.
  // We use `state` to identify which user initiated the flow.
  @Get('oauth2callback')
  async oauth2callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
  ) {
    const host = req.get('host');
    const hostname = (host ?? '').split(':')[0].replace(/^\[|\]$/g, '');
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    const redirectUriOverride = isLocalhost && host
      ? `${req.protocol}://${host}/youtube/oauth2callback`
      : undefined;

    await this.youtubeService.handleOAuthCallback({
      code,
      state,
      redirectUriOverride,
    });

    // Minimal UX: show a small success page so the user can close the tab.
    // (Frontend can also open this in a popup and close it via postMessage later.)
    res
      .status(200)
      .type('html')
      .send(
        `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>YouTube Connected</title></head><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px;">
          <h2 style="margin:0 0 8px;">YouTube connected</h2>
          <p style="margin:0 0 16px;color:#555;">You can close this tab and return to the app.</p>
        </body></html>`,
      );
  }

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  async upload(@GetUser() user: User, @Body() body: YoutubeUploadDto) {
    return this.youtubeService.uploadVideo(user, body);
  }
}
