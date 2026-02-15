import { Injectable, Controller, Post, Delete, Body, Param, Res } from '@nestjs/common';
import { Idempotent } from '@nestjs-redisx/idempotency';
import { CreateSubscriptionDto, SubscriptionService, BillingService, EmailService, ScheduleService, User } from '../types';

@Injectable()
@Controller()
export class SubscriptionController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly billingService: BillingService,
    private readonly emailService: EmailService,
    private readonly scheduleService: ScheduleService,
  ) {}

  @Post('subscriptions')
  @Idempotent({
    ttl: 3600,
    cacheHeaders: ['X-Subscription-Id'],
  })
  async createSubscription(
    @Body() dto: CreateSubscriptionDto,
    @Res() res: any,
  ) {
    // Create subscription
    const subscription = await this.subscriptionService.create({
      planId: dto.planId,
      paymentMethodId: dto.paymentMethodId,
    });

    // Charge first payment
    await this.billingService.chargeInitial(subscription);

    // Send welcome email
    await this.emailService.sendWelcome({}, subscription);

    // Set up recurring billing
    await this.scheduleService.scheduleRecurring(subscription);

    res.setHeader('X-Subscription-Id', subscription.id);
    return res.status(201).json(subscription);
  }

  @Delete('subscriptions/:id')
  @Idempotent({
    ttl: 3600,
    keyExtractor: (ctx) => {
      const req = ctx.switchToHttp().getRequest();
      return `cancel-subscription-${req.params.id}`;
    },
  })
  async cancelSubscription(@Param('id') id: string) {
    const subscription = await this.subscriptionService.findOne(id);

    // Cancel at billing provider
    await this.billingService.cancel(subscription);

    // Update database
    await this.subscriptionService.markCancelled(id);

    // Send confirmation
    await this.emailService.sendCancellationConfirmation(subscription);

    return { status: 'cancelled' };
  }
}
