import { Injectable, Inject } from '@nestjs/common';
import { TRACING_SERVICE, ITracingService } from '@nestjs-redisx/tracing';

@Injectable()
export class UserProcessingService {
  constructor(
    @Inject(TRACING_SERVICE) private readonly tracing: ITracingService,
  ) {}

  async processUser(userId: string): Promise<void> {
    await this.tracing.withSpan('process.user', async () => {
      this.tracing.setAttribute('user.id', userId);

      // Business logic here
      await this.validateUser(userId);
      await this.enrichUserData(userId);

      this.tracing.addEvent('user.processed');
    });
  }

  private async validateUser(_userId: string): Promise<void> {
    // validation logic
  }

  private async enrichUserData(_userId: string): Promise<void> {
    // enrichment logic
  }
}
