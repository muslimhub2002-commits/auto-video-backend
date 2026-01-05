import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Message } from '../../messages/entities/message.entity';
import { Sentence } from './sentence.entity';
import { Voice } from '../../voices/entities/voice.entity';

@Entity('scripts')
export class Script {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string | null;

  @Column({ type: 'text', nullable: false })
  script: string;

  @Column({ type: 'uuid', nullable: false })
  user_id: string;

  @Column({ type: 'uuid', nullable: true })
  message_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  voice_id: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @ManyToOne(() => User, (user) => user.scripts)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Message, (message) => message.scripts)
  @JoinColumn({ name: 'message_id' })
  message: Message;

  @ManyToOne(() => Voice, (voice) => voice.scripts)
  @JoinColumn({ name: 'voice_id' })
  voice: Voice;

  @OneToMany(() => Sentence, (sentence) => sentence.script, { cascade: true })
  sentences: Sentence[];
}
