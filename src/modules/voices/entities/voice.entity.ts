import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Message } from '../../messages/entities/message.entity';
import { Script } from '../../scripts/entities/script.entity';

@Entity('voices')
export class Voice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  voice: string;

  @Column({ type: 'uuid', nullable: false })
  user_id: string;

  @Column({ type: 'int', default: 0 })
  number_of_times_used: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  voice_type: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  voice_lang: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  hash: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @ManyToOne(() => User, (user) => user.voices)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToMany(() => Message, (message) => message.voice)
  messages: Message[];

  @OneToMany(() => Script, (script) => script.voice)
  scripts: Script[];
}
