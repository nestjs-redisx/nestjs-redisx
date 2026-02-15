import { Injectable, Controller, Post, Body, Res } from '@nestjs/common';
import { Idempotent } from '@nestjs-redisx/idempotency';
import { CreatePaymentDto, PaymentGateway, PaymentService, EmailService } from '../types';

@Injectable()
@Controller()
export class PaymentController {
  constructor(
    private readonly paymentGateway: PaymentGateway,
    private readonly paymentService: PaymentService,
    private readonly emailService: EmailService,
  ) {}

  @Post('payments')
  @Idempotent({
    ttl: 86400,  // 24 hours
    cacheHeaders: ['X-Payment-Id', 'X-Transaction-Reference'],
  })
  async createPayment(
    @Body() dto: CreatePaymentDto,
    @Res() res: any,
  ) {
    // Charge payment gateway
    const payment = await this.paymentGateway.charge({
      amount: dto.amount,
      currency: dto.currency,
      source: dto.source,
    });

    // Record in database
    await this.paymentService.record(payment);

    // Send receipt
    await this.emailService.sendReceipt(payment);

    // Set headers for client
    res.setHeader('X-Payment-Id', payment.id);
    res.setHeader('X-Transaction-Reference', payment.transactionRef);

    return res.status(201).json({
      id: payment.id,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
    });
  }
}
