import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { YoutubeController } from './youtube.controller';
import { YoutubeService } from './youtube.service';
import { User } from '../users/entities/user.entity';
import { ScriptsModule } from '../scripts/scripts.module';
import { SocialAccountsModule } from '../social-accounts/social-accounts.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), ScriptsModule, SocialAccountsModule],
  controllers: [YoutubeController],
  providers: [YoutubeService],
  exports: [YoutubeService],
})
export class YoutubeModule {}
