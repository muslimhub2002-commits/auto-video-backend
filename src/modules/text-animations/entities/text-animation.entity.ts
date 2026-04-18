import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('text-animations')
export class TextAnimation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: false })
  user_id: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  title: string;

  @Column({ type: 'jsonb', nullable: false, default: () => "'{}'::jsonb" })
  settings: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  sound_effects: Array<{
    sound_effect_id: string;
    title?: string;
    url?: string;
    delay_seconds?: number;
    volume_percent?: number;
    timing_mode?: 'with_previous' | 'after_previous_ends';
    audio_settings_override?: Record<string, unknown> | null;
    default_audio_settings?: Record<string, unknown> | null;
    duration_seconds?: number | null;
  }> | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}