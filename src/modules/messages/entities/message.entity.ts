import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToOne,
  OneToMany,
} from 'typeorm';
import { Chat } from '../../chats/entities/chat.entity';
import { Video } from '../../videos/entities/video.entity';
import { Voice } from '../../voices/entities/voice.entity';
import { Image } from '../../images/entities/image.entity';
import { Script } from '../../scripts/entities/script.entity';

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: false })
  chat_id: string;

  @Column({ type: 'uuid', nullable: true, unique: true })
  video_id: string;

  @Column({ type: 'uuid', nullable: true })
  voice_id: string;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @ManyToOne(() => Chat, (chat) => chat.messages)
  @JoinColumn({ name: 'chat_id' })
  chat: Chat;

  @OneToOne(() => Video, (video) => video.message)
  @JoinColumn({ name: 'video_id' })
  video: Video;

  @ManyToOne(() => Voice, (voice) => voice.messages)
  @JoinColumn({ name: 'voice_id' })
  voice: Voice;

  @OneToMany(() => Image, (image) => image.message)
  images: Image[];

  @OneToMany(() => Script, (script) => script.message)
  scripts: Script[];
}

