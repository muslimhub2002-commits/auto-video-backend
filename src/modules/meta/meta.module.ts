import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetaController } from './meta.controller';
import { MetaService } from './meta.service';
import { MessagesModule } from '../messages/messages.module';
import { ScriptsModule } from '../scripts/scripts.module';
import { MetaCredential } from './entities/meta-credential.entity';

@Module({
  imports: [TypeOrmModule.forFeature([MetaCredential]), MessagesModule, ScriptsModule],
  controllers: [MetaController],
  providers: [MetaService],
  exports: [MetaService],
})
export class MetaModule {}