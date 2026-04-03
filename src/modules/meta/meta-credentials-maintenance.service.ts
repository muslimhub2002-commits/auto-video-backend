import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MetaCredentialsService } from './meta-credentials.service';

@Injectable()
export class MetaCredentialsMaintenanceService implements OnModuleInit {
  private readonly logger = new Logger(MetaCredentialsMaintenanceService.name);

  constructor(
    private readonly metaCredentialsService: MetaCredentialsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.runMaintenance('startup');
  }

  @Cron('0 */12 * * *')
  async handleScheduledRefresh(): Promise<void> {
    await this.runMaintenance('scheduled');
  }

  private async runMaintenance(reason: string): Promise<void> {
    try {
      const status = await this.metaCredentialsService.runScheduledMaintenance(reason);
      if (status) {
        this.logger.log(
          `Meta credential maintenance (${reason}) finished with status=${status.connectionStatus}.`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : 'Unknown Meta maintenance error.';
      this.logger.warn(
        `Meta credential maintenance (${reason}) failed: ${message}`,
      );
    }
  }
}