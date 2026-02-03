import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  ManyToMany,
  JoinColumn,
  JoinTable,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Message } from '../../messages/entities/message.entity';
import { Sentence } from './sentence.entity';
import { Voice } from '../../voices/entities/voice.entity';
import { ScriptTemplate } from './script-template.entity';

@Entity('scripts')
export class Script {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string | null;

  @Column({ type: 'text', nullable: false })
  script: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  subject: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  subject_content: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  length: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  style: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  technique: string | null;

  @Column({ type: 'uuid', nullable: false })
  user_id: string;

  @Column({ type: 'uuid', nullable: true })
  message_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  voice_id: string | null;

  // Optional generated video associated with this draft.
  // We store the URL directly so drafts can restore the preview.
  @Column({ type: 'varchar', length: 2048, nullable: true })
  video_url: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

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

  @ManyToMany(() => ScriptTemplate, (template) => template.scripts)
  templates: ScriptTemplate[];

  @ManyToMany(() => Script)
  @JoinTable({
    name: 'script_reference_scripts',
    joinColumn: { name: 'script_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'reference_script_id', referencedColumnName: 'id' },
  })
  reference_scripts: Script[];
}
