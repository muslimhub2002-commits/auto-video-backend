import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToOne,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Message } from '../../messages/entities/message.entity';

export enum VideoSize {
  PORTRAIT = 'portrait',
  LANDSCAPE = 'landscape',
}

@Entity('videos')
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  video: string;

  @Column({ type: 'uuid', nullable: false })
  user_id: string;

  @Column({
    type: 'enum',
    enum: VideoSize,
    nullable: true,
  })
  video_size: VideoSize;

  @Column({ type: 'varchar', length: 50, nullable: true })
  video_type: string;

  @Column({ type: 'int', nullable: true })
  height: number;

  @Column({ type: 'int', nullable: true })
  width: number;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @ManyToOne(() => User, (user) => user.videos)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToOne(() => Message, (message) => message.video)
  message: Message;
}

