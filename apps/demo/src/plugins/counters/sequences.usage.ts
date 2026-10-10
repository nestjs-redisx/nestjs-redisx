import { Injectable, Inject } from '@nestjs/common';
import { COUNTER_SERVICE, ICounterService } from '@nestjs-redisx/counters';

@Injectable()
export class InvoiceNumberService {
  constructor(
    @Inject(COUNTER_SERVICE)
    private readonly counters: ICounterService,
  ) {}

  // Monotonic fleet-wide sequence: 1, 2, 3, ... with no collisions across
  // instances. Sequences have no TTL by definition.
  async nextInvoiceNumber(): Promise<string> {
    const n = await this.counters.next('seq:invoices');
    return `INV-${String(n).padStart(6, '0')}`;
  }

  async lastIssued(): Promise<number> {
    return this.counters.current('seq:invoices'); // 0 before the first next()
  }
}
