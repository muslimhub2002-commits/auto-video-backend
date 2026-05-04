import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SavedSequence } from './entities/saved-sequence.entity';
import { SavedSequencesController } from './saved-sequences.controller';
import { SavedSequencesService } from './saved-sequences.service';

@Module({
  imports: [TypeOrmModule.forFeature([SavedSequence])],
  controllers: [SavedSequencesController],
  providers: [SavedSequencesService],
  exports: [SavedSequencesService],
})
export class SavedSequencesModule {}