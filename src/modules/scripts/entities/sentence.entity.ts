import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Script } from './script.entity';
import { Image } from '../../images/entities/image.entity';
import { Video } from '../../videos/entities/video.entity';

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

  @Column({ type: 'boolean', default: false })
  isSuspense: boolean;

  // Optional per-sentence override: if present, the image prompt should reference
  // exactly these canonical character keys and skip mention/detection logic.
  @Column({ type: 'jsonb', nullable: true })
  forced_character_keys: string[] | null;

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
}
