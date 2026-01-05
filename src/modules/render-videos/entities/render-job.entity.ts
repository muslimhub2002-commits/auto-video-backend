import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type RenderJobStatus =
  | 'queued'
  | 'processing'
  | 'rendering'
  | 'completed'
  | 'failed';

@Entity('render_jobs')
export class RenderJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32, default: 'queued' })
  status: RenderJobStatus;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'text' })
  audioPath: string;

  @Column({ type: 'text', nullable: true })
  videoPath: string | null;

  @Column({ type: 'jsonb', nullable: true })
  timeline: any | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}


