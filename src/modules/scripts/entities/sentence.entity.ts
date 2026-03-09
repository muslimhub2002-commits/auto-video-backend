import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Script } from './script.entity';
import { Image } from '../../images/entities/image.entity';
import { Video } from '../../videos/entities/video.entity';
import { SentenceSoundEffect } from './sentence-sound-effect.entity';

@Entity('sentences')
export class Sentence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', nullable: false })
  text: string;

  @Column({ type: 'int', nullable: false })
  index: number;

  @Column({ type: 'uuid', nullable: false })
  script_id: string;

  @Column({ type: 'uuid', nullable: true })
  image_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  start_frame_image_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  end_frame_image_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  video_id: string | null;

  // Optional per-sentence video prompt (used for AI video generation modes).
  @Column({ type: 'text', nullable: true })
  video_prompt: string | null;

  @Column({ type: 'boolean', default: false })
  align_sound_effects_to_scene_end: boolean;

  // Optional per-sentence override for the cut/transition to the next sentence.
  // Null means auto-selection by the renderer.
  @Column({ type: 'text', nullable: true })
  transition_to_next: string | null;

  // Optional per-sentence visual effect applied on the media itself.
  // Null means no effect.
  @Column({ type: 'text', nullable: true })
  visual_effect: string | null;

  // Optional per-sentence image motion preset.
  // Null means legacy/default behavior.
  @Column({ type: 'text', nullable: true })
  image_motion_effect: string | null;

  @Column({ type: 'real', nullable: true })
  image_motion_speed: number | null;

  // Optional per-cut custom transition sounds for the cut from this sentence
  // into the next one. Stored inline so unsaved multi-sound mixes can round-trip.
  @Column({ type: 'jsonb', nullable: true })
  transition_sound_effects: Array<{
    sound_effect_id: string;
    title?: string;
    url?: string;
    delay_seconds?: number;
    volume_percent?: number;
  }> | null;

  @Column({ type: 'boolean', default: false })
  isSuspense: boolean;

  // Optional per-sentence override: if present, the image prompt should reference
  // exactly these canonical character keys and skip mention/detection logic.
  @Column({ type: 'jsonb', nullable: true })
  forced_character_keys: string[] | null;

  // Canonical character keys inferred during splitting (non-forced).
  @Column({ type: 'jsonb', nullable: true })
  character_keys: string[] | null;

  // Canonical era key inferred during splitting (non-forced).
  @Column({ type: 'text', nullable: true })
  era_key: string | null;

  // Optional per-sentence override for era selection.
  @Column({ type: 'text', nullable: true })
  forced_era_key: string | null;

  @ManyToOne(() => Script, (script) => script.sentences, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'script_id' })
  script: Script;

  @ManyToOne(() => Image, { nullable: true })
  @JoinColumn({ name: 'image_id' })
  image: Image | null;

  @ManyToOne(() => Image, { nullable: true })
  @JoinColumn({ name: 'start_frame_image_id' })
  startFrameImage: Image | null;

  @ManyToOne(() => Image, { nullable: true })
  @JoinColumn({ name: 'end_frame_image_id' })
  endFrameImage: Image | null;

  @ManyToOne(() => Video, { nullable: true })
  @JoinColumn({ name: 'video_id' })
  video: Video | null;

  @OneToMany(
    () => SentenceSoundEffect,
    (sentenceSoundEffect) => sentenceSoundEffect.sentence,
  )
  sound_effects: SentenceSoundEffect[];
}
