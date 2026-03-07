import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('sound_effects')
export class SoundEffect {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: false })
  user_id: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  title: string;

  // Display name for the sound effect (defaults to the uploaded file name).
  @Column({ type: 'varchar', length: 255, nullable: false, default: '' })
  name: string;

  @Column({ type: 'varchar', length: 2048, nullable: false })
  url: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  public_id: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  hash: string | null;

  @Column({ type: 'int', default: 0 })
  number_of_times_used: number;

  // Default volume for this sound effect when inserted into a sentence.
  @Column({ type: 'float', default: 100 })
  volume_percent: number;

  @Column({ type: 'boolean', default: false })
  is_merged: boolean;

  @Column({ type: 'jsonb', nullable: true })
  merged_from: any | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
