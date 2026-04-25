import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetaController } from './meta.controller';
import { MetaCredentialsMaintenanceService } from './meta-credentials-maintenance.service';
import { MetaCredentialsService } from './meta-credentials.service';
import { MetaService } from './meta.service';
import { ScriptsModule } from '../scripts/scripts.module';
import { MetaCredential } from './entities/meta-credential.entity';
import { SocialAccountsModule } from '../social-accounts/social-accounts.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MetaCredential]),
    ScriptsModule,
    SocialAccountsModule,
  ],
  controllers: [MetaController],
  providers: [
    MetaCredentialsMaintenanceService,
    MetaCredentialsService,
    MetaService,
  ],
  exports: [MetaCredentialsService, MetaService],
})
export class MetaModule {}
