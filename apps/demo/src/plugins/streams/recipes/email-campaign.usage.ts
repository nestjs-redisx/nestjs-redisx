import { Injectable, Inject } from '@nestjs/common';
import { StreamConsumer, IStreamMessage, STREAM_PRODUCER, IStreamProducer } from '@nestjs-redisx/streams';
import { Campaign, CampaignEmail, EmailService, CampaignRepo } from '../types';

@Injectable()
export class EmailCampaign {
  constructor(
    @Inject(STREAM_PRODUCER) private readonly producer: IStreamProducer,
    private readonly emailService: EmailService,
    private readonly campaignRepo: CampaignRepo,
  ) {}

  async sendCampaign(campaign: Campaign): Promise<void> {
    const recipients = await this.getRecipients(campaign.id);

    // Publish each recipient as separate message
    for (const recipient of recipients) {
      await this.producer.publish('campaigns', {
        campaignId: campaign.id,
        recipientId: recipient.id,
        email: recipient.email,
        template: campaign.template,
        variables: this.getVariables(recipient),
      });
    }
  }

  @StreamConsumer({
    stream: 'campaigns',
    group: 'senders',
    concurrency: 50,  // High concurrency for I/O
    batchSize: 100,
  })
  async sendEmail(message: IStreamMessage<CampaignEmail>): Promise<void> {
    const email = message.data;

    try {
      // Send email
      await this.emailService.send({
        to: email.email,
        template: email.template,
        variables: email.variables,
      });

      // Track delivery
      await this.campaignRepo.incrementSent(email.campaignId);

      await message.ack();
    } catch (error) {
      if ((error as Error).message.includes('rate limit')) {
        // Rate limited - retry after delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        await message.reject(error as Error);
      } else {
        // Other error - log and mark as bounced
        await this.campaignRepo.incrementBounced(email.campaignId);
        await message.ack();  // Don't retry
      }
    }
  }

  private async getRecipients(campaignId: string): Promise<Array<{ id: string; email: string }>> {
    return []; // Stub: fetch from database
  }

  private getVariables(recipient: any): Record<string, string> {
    return {}; // Stub: build template variables
  }
}
