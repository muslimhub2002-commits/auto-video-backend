import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Image } from '../../images/entities/image.entity';
import { Voice } from '../../voices/entities/voice.entity';
import { Video } from '../../videos/entities/video.entity';
import { Chat } from '../../chats/entities/chat.entity';
import { Script } from '../../scripts/entities/script.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, nullable: false, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  password: string;

  @Column({ type: 'int', default: 0 })
  number_of_videos_generated: number;

  @Column({ type: 'int', default: 0 })
  number_of_images_generated: number;

  @Column({ type: 'int', default: 0 })
  number_of_voices_generated: number;

  @Column({ type: 'simple-array', nullable: true })
  roles: string[];

  @Column({ type: 'text', nullable: true })
  youtube_access_token: string | null;

  @Column({ type: 'text', nullable: true })
  youtube_refresh_token: string | null;

  @Column({ type: 'timestamp', nullable: true })
  youtube_token_expiry: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  youtube_connected_at: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  @OneToMany(() => Image, (image) => image.user)
  images: Image[];

  @OneToMany(() => Voice, (voice) => voice.user)
  voices: Voice[];

  @OneToMany(() => Video, (video) => video.user)
  videos: Video[];

  @OneToMany(() => Chat, (chat) => chat.user)
  chats: Chat[];

  @OneToMany(() => Script, (script) => script.user)
  scripts: Script[];
}
