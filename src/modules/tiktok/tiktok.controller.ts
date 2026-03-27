import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Readable } from 'stream';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import { TiktokUploadDto } from './dto/tiktok-upload.dto';
import { TiktokService } from './tiktok.service';

@Controller('tiktok')
export class TiktokController {
  constructor(private readonly tiktokService: TiktokService) {}

  @Get('pull')
  async pull(
    @Query('source') source?: string,
    @Query('expires') expires?: string,
    @Query('sig') sig?: string,
    @Res() res?: Response,
  ) {
    const response = res;
    if (!response) {
      throw new BadRequestException('Missing response object.');
    }

    const { upstream } = await this.tiktokService.proxyPullSource({
      sourceUrl: source,
      expires,
      signature: sig,
    });

    response.status(upstream.status);
    const contentType = upstream.headers.get('content-type');
    const contentLength = upstream.headers.get('content-length');
    const contentDisposition = upstream.headers.get('content-disposition');

    if (contentType) response.setHeader('Content-Type', contentType);
    if (contentLength) response.setHeader('Content-Length', contentLength);
    if (contentDisposition) {
      response.setHeader('Content-Disposition', contentDisposition);
    }
    response.setHeader('Cache-Control', 'private, max-age=300');

    const body: any = (upstream as any).body;
    if (!body) {
      return response.end();
    }

    if (typeof body.pipe === 'function') {
      return body.pipe(response);
    }

    const fromWeb = (Readable as any).fromWeb;
    if (typeof fromWeb === 'function') {
      return fromWeb(body).pipe(response);
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    return response.end(buffer);
  }

  @UseGuards(JwtAuthGuard)
  @Get('auth-url')
  async getAuthUrl(@Req() req: Request, @GetUser() user: User) {
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

    const url = await this.tiktokService.getAuthUrl(user, redirectUriOverride);
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
  async getCreatorInfo(@GetUser() user: User) {
    return this.tiktokService.getCreatorInfo(user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  async upload(@GetUser() user: User, @Body() body: TiktokUploadDto) {
    return this.tiktokService.uploadVideo(user, body);
  }
}