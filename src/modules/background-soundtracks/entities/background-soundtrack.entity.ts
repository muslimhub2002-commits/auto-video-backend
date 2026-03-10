import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import type { SoundEffectAudioSettings } from '../../sound-effects/audio-settings.types';

@Entity('background_soundtracks')
export class BackgroundSoundtrack {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: false })
  user_id: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  title: string;

  @Column({ type: 'varchar', length: 2048, nullable: false })
  url: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  public_id: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  hash: string | null;

  @Column({ type: 'int', default: 0 })
  number_of_times_used: number;

  @Column({ type: 'boolean', default: false })
  is_favorite: boolean;

  @Column({ type: 'float', default: 100 })
  volume_percent: number;

  @Column({ type: 'jsonb', nullable: true })
  audio_settings: SoundEffectAudioSettings | null;

  @Column({ type: 'boolean', default: false })
  is_preset: boolean;

  @Column({ type: 'uuid', nullable: true })
  source_soundtrack_id: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
