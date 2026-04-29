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
import { Sentence } from './sentence.entity';
import { Voice } from '../../voices/entities/voice.entity';
import { ScriptTemplate } from './script-template.entity';

@Entity('scripts')
export class Script {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ISO language code for this script (e.g. "en", "ar", "fr", "zh-CN").
  @Column({ type: 'varchar', length: 20, default: 'en' })
  language: string;

  // When true, this script row represents a short derived from a long-form script.
  // These rows are hidden from the normal scripts listing.
  @Column({ type: 'boolean', default: false })
  isShortScript: boolean;

  // Ordered list of Script IDs (UUIDs) that represent the derived shorts.
  // Stored on the parent (full video) script.
  @Column({ type: 'jsonb', nullable: true })
  shorts_scripts: string[] | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string | null;

  @Column({ type: 'text', nullable: false })
  script: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  subject: string | null;

  @Column({ type: 'text', nullable: true })
  subject_content: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  length: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  style: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  technique: string | null;

  // Canonical character list extracted during splitting.
  // Stored so drafts/library restore keeps stable keys + classification flags.
  @Column({ type: 'jsonb', nullable: true })
  characters: Array<{
    key: string;
    name: string;
    description: string;
    isSahaba: boolean;
    isProphet: boolean;
    isWoman: boolean;
  }> | null;

  // Canonical location list extracted during splitting.
  // Stored so drafts/library restore keeps stable keys + consistent prompting.
  @Column({ type: 'jsonb', nullable: true })
  locations: Array<{
    key: string;
    name: string;
    description?: string;
  }> | null;

  // Ordered source chunks for long voice-over generation.
  // When present, the client rebuilds the merged voice from these chunks.
  @Column({ type: 'jsonb', nullable: true })
  voice_over_chunks: Array<{
    index: number;
    text: string;
    sentences: string[];
    provider: string | null;
    providerVoiceId?: string | null;
    providerVoiceName?: string | null;
    mimeType: string | null;
    styleInstructions?: string | null;
    durationSeconds: number | null;
    estimatedSeconds: number | null;
    url: string;
    fileName?: string | null;
    createdAt?: string | null;
    elevenLabsSettings?: {
      stability?: number | null;
      similarityBoost?: number | null;
      style?: number | null;
      speed?: number | null;
      useSpeakerBoost?: boolean | null;
    } | null;
  }> | null;

  @Column({ type: 'jsonb', nullable: true })
  voice_generation_config: {
    mode: 'auto' | 'perSentence';
    provider: 'google' | 'elevenlabs' | null;
    providerVoiceId: string | null;
    styleInstructions?: string | null;
    elevenLabsSettings?: {
      stability?: number | null;
      similarityBoost?: number | null;
      style?: number | null;
      speed?: number | null;
      useSpeakerBoost?: boolean | null;
    } | null;
  } | null;

  @Column({ type: 'uuid', nullable: false })
  user_id: string;

  @Column({ type: 'uuid', nullable: true })
  voice_id: string | null;

  // Optional generated video URL for unpublished or partially published scripts.
  // Stored to enable preview restoration across publishing states.
  @Column({ type: 'varchar', length: 2048, nullable: true })
  video_url: string | null;

  // Optional YouTube URL for the uploaded video.
  @Column({ type: 'varchar', length: 2048, nullable: true })
  youtube_url: string | null;

  // Optional Facebook URL for the uploaded video.
  @Column({ type: 'varchar', length: 2048, nullable: true })
  facebook_url: string | null;

  // Optional Instagram URL for the uploaded video.
  @Column({ type: 'varchar', length: 2048, nullable: true })
  instagram_url: string | null;

  // Optional TikTok URL for the uploaded video.
  @Column({ type: 'varchar', length: 2048, nullable: true })
  tiktok_url: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  @ManyToOne(() => User, (user) => user.scripts)
  @JoinColumn({ name: 'user_id' })
  user: User;

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
    inverseJoinColumn: {
      name: 'reference_script_id',
      referencedColumnName: 'id',
    },
  })
  reference_scripts: Script[];
}
