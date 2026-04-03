import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('meta_credentials')
export class MetaCredential {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true, default: 'shared' })
  scope: string;

  @Column({ type: 'text', nullable: true })
  meta_access_token: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  meta_token_type: string | null;

  @Column({ type: 'timestamp', nullable: true })
  meta_token_expires_at: Date | null;

  @Column({ type: 'text', nullable: true })
  facebook_page_access_token: string | null;

  @Column({ type: 'timestamp', nullable: true })
  facebook_page_token_expires_at: Date | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  facebook_page_id: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  instagram_account_id: string | null;

  @Column({ type: 'timestamp', nullable: true })
  connected_at: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  last_refreshed_at: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  last_refresh_attempt_at: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  last_refresh_success_at: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  last_refresh_error_at: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  next_refresh_due_at: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  requires_reconnect_at: Date | null;

  @Column({ type: 'varchar', length: 32, default: 'not_connected' })
  connection_status: string;

  @Column({ type: 'text', nullable: true })
  last_error: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}