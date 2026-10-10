import { Injectable } from '@nestjs/common';
import { Dedupe } from '@nestjs-redisx/dedup';
import { StripeEvent } from './types';

@Injectable()
export class WebhookService {
  // Providers redeliver: each event id is handled once per 5 minutes,
  // fleet-wide. Duplicate deliveries resolve to undefined without running
  // the body. A THROWN first attempt releases the marker, so the provider's
  // retry is not locked out for the rest of the window.
  @Dedupe({ key: 'stripe:{0}', window: 300_000 })
  async handleStripeEvent(eventId: string, event: StripeEvent): Promise<void> {
    // ...apply the event exactly once per window...
  }
}
