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

@Entity('overlays')
export class Overlay {
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

  @Column({ type: 'varchar', length: 255, nullable: true })
  mime_type: string | null;

  @Column({ type: 'jsonb', nullable: false, default: () => "'{}'::jsonb" })
  settings: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}