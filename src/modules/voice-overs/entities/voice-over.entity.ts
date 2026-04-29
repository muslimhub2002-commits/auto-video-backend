import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('voice_overs')
@Index(['user_id', 'provider'])
export class VoiceOver {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', nullable: true })
  user_id: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  hash: string | null;

  // Provider for the voice catalog (ElevenLabs vs Google TTS / AI Studio)
  @Column({ type: 'varchar', default: 'elevenlabs' })
  provider!: 'elevenlabs' | 'google';

  @Column({ type: 'varchar', length: 255 })
  voice_id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'boolean', default: false })
  isFavorite: boolean;

  @Column({ type: 'varchar', length: 500, nullable: true })
  preview_url?: string | null;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  category?: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  gender?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  accent?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  descriptive?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  use_case?: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User | null;
}
