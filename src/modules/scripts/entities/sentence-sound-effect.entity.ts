import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Sentence } from './sentence.entity';
import { SoundEffect } from '../../sound-effects/entities/sound-effect.entity';
import type { SoundEffectAudioSettings } from '../../sound-effects/audio-settings.types';

export const SENTENCE_SOUND_EFFECT_TIMING_MODES = [
  'with_previous',
  'after_previous_ends',
] as const;

export type SentenceSoundEffectTimingMode =
  (typeof SENTENCE_SOUND_EFFECT_TIMING_MODES)[number];

@Entity('sentence_sound_effects')
@Index(['sentence_id', 'index'], { unique: true })
export class SentenceSoundEffect {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: false })
  sentence_id: string;

  @Column({ type: 'uuid', nullable: false })
  sound_effect_id: string;

  @Column({ type: 'int', nullable: false })
  index: number;

  @Column({ type: 'double precision', nullable: false, default: 0 })
  delay_seconds: number;

  @Column({
    type: 'varchar',
    length: 32,
    nullable: false,
    default: 'with_previous',
  })
  timing_mode: SentenceSoundEffectTimingMode;

  // Optional per-sentence override. When null, the library item's volume_percent is used.
  @Column({ type: 'int', nullable: true })
  volume_percent: number | null;

  @Column({ type: 'jsonb', nullable: true })
  audio_settings_override: SoundEffectAudioSettings | null;

  @ManyToOne(() => Sentence, (sentence) => (sentence as any).sound_effects, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'sentence_id' })
  sentence: Sentence;

  @ManyToOne(() => SoundEffect, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'sound_effect_id' })
  sound_effect: SoundEffect;
}
