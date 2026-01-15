import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('voice_overs')
export class VoiceOver {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255, unique: true })
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
}
