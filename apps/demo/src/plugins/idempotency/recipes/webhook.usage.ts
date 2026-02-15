import { Injectable, Controller, Post, Body, Headers } from '@nestjs/common';
import { Idempotent } from '@nestjs-redisx/idempotency';
import { StripeWebhookEvent, StripeService } from '../types';

@Injectable()
@Controller()
export class WebhookController {
  constructor(
    private readonly stripeService: StripeService,
  ) {}

  @Post('webhooks/stripe')
  @Idempotent({
    ttl: 86400,
    keyExtractor: (ctx) => {
      const req = ctx.switchToHttp().getRequest();
      // Use Stripe's webhook ID
      return req.headers['stripe-webhook-id'];
    },
    // Body may vary slightly, don't validate fingerprint
    fingerprintFields: ['method', 'path'],
  })
  async handleStripeWebhook(
    @Body() event: StripeWebhookEvent,
    @Headers('stripe-signature') signature: string,
  ) {
    // Verify signature
    this.stripeService.verifySignature(event, signature);

    // Process event (only once even if Stripe retries)
    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentSuccess(event.data);
        break;
      case 'payment_intent.failed':
        await this.handlePaymentFailure(event.data);
        break;
    }

    return { received: true };
  }

  private async handlePaymentSuccess(data: unknown): Promise<void> {}
  private async handlePaymentFailure(data: unknown): Promise<void> {}
}
