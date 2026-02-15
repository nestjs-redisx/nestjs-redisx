import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  IDEMPOTENCY_SERVICE,
  IIdempotencyService,
} from '@nestjs-redisx/idempotency';
import { PaymentDto, PaymentResponse, PaymentGateway } from './types';

@Injectable()
export class ManualIdempotencyService {
  constructor(
    @Inject(IDEMPOTENCY_SERVICE)
    private readonly idempotency: IIdempotencyService,
    private readonly paymentGateway: PaymentGateway,
  ) {}

  async createPayment(
    key: string,
    dto: PaymentDto,
  ): Promise<PaymentResponse> {
    // 1. Generate fingerprint
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(dto))
      .digest('hex');

    // 2. Check and lock (handles concurrent requests internally)
    const result = await this.idempotency.checkAndLock(key, fingerprint, {
      ttl: 86400,
    });

    // 3. Handle existing record
    if (!result.isNew && result.record) {
      if (result.record.status === 'completed') {
        return {
          statusCode: result.record.statusCode,
          body: JSON.parse(result.record.response),
          headers: JSON.parse(result.record.headers || '{}'),
        };
      }

      if (result.record.status === 'failed') {
        throw new BadRequestException(result.record.error);
      }
    }

    // 4. Process new request
    try {
      const payment = await this.paymentGateway.charge(dto);

      await this.idempotency.complete(key, {
        statusCode: 201,
        body: payment,
        headers: {
          'X-Payment-Id': payment.id,
        },
      });

      return {
        statusCode: 201,
        body: payment,
        headers: {
          'X-Payment-Id': payment.id,
        },
      };
    } catch (error) {
      await this.idempotency.fail(key, error.message);
      throw error;
    }
  }
}
