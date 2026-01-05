import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Message } from '../../messages/entities/message.entity';

export enum ImageSize {
  PORTRAIT = 'portrait',
  LANDSCAPE = 'landscape',
}

export enum ImageQuality {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

@Entity('images')
export class Image {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  image: string;

  @Column({ type: 'uuid', nullable: false })
  user_id: string;

  @Column({ type: 'uuid', nullable: true })
  message_id: string | null;

  @Column({ type: 'int', default: 0 })
  number_of_times_used: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  image_style: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  public_id: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  hash: string | null;

  @Column({
    type: 'enum',
    enum: ImageSize,
    nullable: true,
  })
  image_size: ImageSize;

  @Column({
    type: 'enum',
    enum: ImageQuality,
    nullable: true,
  })
  image_quality: ImageQuality;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @ManyToOne(() => User, (user) => user.images)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Message, (message) => message.images)
  @JoinColumn({ name: 'message_id' })
  message: Message;
}

