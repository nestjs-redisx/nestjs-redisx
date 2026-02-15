import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { METRICS_SERVICE, IMetricsService } from '@nestjs-redisx/metrics';
import { PaymentDto, Payment, PaymentGateway } from './types';

@Injectable()
export class PaymentService implements OnModuleInit {
  constructor(
    @Inject(METRICS_SERVICE) private readonly metrics: IMetricsService,
    private readonly gateway: PaymentGateway,
  ) {}

  onModuleInit(): void {
    this.metrics.registerHistogram(
      'payment_duration_seconds',
      'Payment processing duration',
      ['provider'],
      [0.1, 0.5, 1, 2, 5, 10],
    );
  }

  async processPayment(dto: PaymentDto): Promise<Payment> {
    const stopTimer = this.metrics.startTimer('payment_duration_seconds', {
      provider: dto.provider,
    });

    try {
      const payment = await this.gateway.charge(dto);
      stopTimer();  // Records duration and returns seconds
      return payment;
    } catch (error) {
      stopTimer();
      throw error;
    }
  }
}
