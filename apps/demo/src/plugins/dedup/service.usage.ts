import { Injectable, Inject } from '@nestjs/common';
import { DEDUP_SERVICE, IDedupService } from '@nestjs-redisx/dedup';
import { Mailer } from './types';

@Injectable()
export class OrderEventsService {
  constructor(
    @Inject(DEDUP_SERVICE)
    private readonly dedup: IDedupService,
    private readonly mailer: Mailer,
  ) {}

  // dedupe(): run the side effect for the FIRST occurrence only.
  async onOrderCreated(orderId: string): Promise<void> {
    await this.dedup.dedupe(`order-created:${orderId}`, () => this.mailer.sendOrderConfirmation(orderId));
  }

  // isFirst(): plain boolean check when you steer the flow yourself.
  async shouldProcess(messageId: string): Promise<boolean> {
    return this.dedup.isFirst(`queue:${messageId}`, { window: 600_000 });
  }

  // release(): manually re-admit a key (support tooling, forced retry).
  async allowRetry(orderId: string): Promise<boolean> {
    return this.dedup.release(`order-created:${orderId}`);
  }
}
