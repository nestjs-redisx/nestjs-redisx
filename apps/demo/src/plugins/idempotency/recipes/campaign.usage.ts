import { Injectable, Controller, Post, Param, ConflictException } from '@nestjs/common';
import { Idempotent } from '@nestjs-redisx/idempotency';
import { CampaignService, EmailQueue } from '../types';

@Injectable()
@Controller()
export class CampaignController {
  constructor(
    private readonly campaignService: CampaignService,
    private readonly emailQueue: EmailQueue,
  ) {}

  @Post('campaigns/:id/send')
  @Idempotent({
    ttl: 86400,
    keyExtractor: (ctx) => {
      const req = ctx.switchToHttp().getRequest();
      return `campaign-send-${req.params.id}`;
    },
  })
  async sendCampaign(@Param('id') campaignId: string) {
    const campaign = await this.campaignService.findOne(campaignId);

    if (campaign.status === 'sent') {
      throw new ConflictException('Campaign already sent');
    }

    // Get recipients
    const recipients = await this.campaignService.getRecipients(campaignId);

    // Queue emails
    await Promise.all(
      recipients.map((recipient: any) =>
        this.emailQueue.add('send-campaign-email', {
          campaignId,
          recipientId: recipient.id,
        }),
      ),
    );

    // Mark as sent
    await this.campaignService.markSent(campaignId);

    return {
      campaignId,
      status: 'sent',
      recipientCount: recipients.length,
    };
  }
}
