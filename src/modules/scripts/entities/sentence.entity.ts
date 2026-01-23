import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Script } from './script.entity';
import { Image } from '../../images/entities/image.entity';

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

  @Column({ type: 'boolean', default: false })
  isSuspense: boolean;

  @ManyToOne(() => Script, (script) => script.sentences, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'script_id' })
  script: Script;

  @ManyToOne(() => Image, { nullable: true })
  @JoinColumn({ name: 'image_id' })
  image: Image | null;
}
