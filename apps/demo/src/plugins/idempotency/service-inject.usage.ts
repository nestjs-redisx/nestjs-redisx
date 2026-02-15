import { Injectable, Inject } from '@nestjs/common';
import {
  IDEMPOTENCY_SERVICE,
  IIdempotencyService,
} from '@nestjs-redisx/idempotency';

@Injectable()
export class PaymentService {
  constructor(
    @Inject(IDEMPOTENCY_SERVICE)
    private readonly idempotency: IIdempotencyService,
  ) {}
}
