import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum VideoSize {
  PORTRAIT = 'portrait',
  LANDSCAPE = 'landscape',
}

@Entity('videos')
@Index(['user_id', 'hash'])
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  video: string;

  @Column({ type: 'uuid', nullable: false })
  user_id: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  hash: string | null;

  @Column({
    type: 'enum',
    enum: VideoSize,
    nullable: true,
  })
  video_size: VideoSize | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  video_type: string | null;

  @Column({ type: 'int', nullable: true })
  height: number | null;

  @Column({ type: 'int', nullable: true })
  width: number | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @ManyToOne(() => User, (user) => user.videos)
  @JoinColumn({ name: 'user_id' })
  user: User;
}
