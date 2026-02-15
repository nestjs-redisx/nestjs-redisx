import { Injectable, Inject } from '@nestjs/common';
import { StreamConsumer, IStreamMessage, STREAM_PRODUCER, IStreamProducer } from '@nestjs-redisx/streams';
import { Webhook, WebhookEvent, WebhookRepo, AlertService } from '../types';

@Injectable()
export class WebhookDelivery {
  constructor(
    @Inject(STREAM_PRODUCER) private readonly producer: IStreamProducer,
    private readonly webhookRepo: WebhookRepo,
    private readonly alertService: AlertService,
  ) {}

  async send(webhook: Webhook): Promise<void> {
    await this.producer.publish('webhooks', {
      id: webhook.id,
      url: webhook.url,
      event: webhook.event,
      payload: webhook.payload,
      signature: this.generateSignature(webhook.payload),
    });
  }

  @StreamConsumer({
    stream: 'webhooks',
    group: 'delivery',
    concurrency: 10,
    maxRetries: 5,  // Retry up to 5 times
  })
  async deliver(message: IStreamMessage<WebhookEvent>): Promise<void> {
    const webhook = message.data;

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': webhook.signature,
          'X-Webhook-ID': webhook.id,
          'X-Webhook-Attempt': message.attempt.toString(),
        },
        body: JSON.stringify(webhook.payload),
        signal: AbortSignal.timeout(30000),  // 30s timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Log successful delivery
      await this.webhookRepo.updateStatus(webhook.id, 'delivered');
      await message.ack();
    } catch (error) {
      // Log failed attempt
      await this.webhookRepo.logAttempt(webhook.id, {
        attempt: message.attempt,
        error: (error as Error).message,
        timestamp: new Date(),
      });

      if (message.attempt >= 5) {
        // Final failure - move to DLQ
        await this.webhookRepo.updateStatus(webhook.id, 'failed');
        await this.alertService.send({
          title: 'Webhook Delivery Failed',
          message: `Failed to deliver webhook ${webhook.id} after 5 attempts`,
        });
      }

      await message.reject(error as Error);
    }
  }

  private generateSignature(payload: unknown): string {
    return 'sha256-signature'; // Stub: use crypto.createHmac in production
  }
}
