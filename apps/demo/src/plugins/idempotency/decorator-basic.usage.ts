import { Controller, Post, Body } from '@nestjs/common';
import { Idempotent } from '@nestjs-redisx/idempotency';
import { CreatePaymentDto, PaymentService } from './types';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post()
  @Idempotent()
  async createPayment(@Body() dto: CreatePaymentDto) {
    // Executes exactly once per Idempotency-Key
    return this.paymentService.process(dto);
  }
}
