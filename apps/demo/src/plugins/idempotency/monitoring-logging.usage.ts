import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class IdempotencyLogger {
  private readonly logger = new Logger('Idempotency');

  onNewRequest(key: string, fingerprint: string): void {
    this.logger.log({
      event: 'new_request',
      key,
      fingerprint,
      timestamp: new Date().toISOString(),
    });
  }

  onDuplicate(key: string, cachedAt: Date): void {
    this.logger.log({
      event: 'duplicate_request',
      key,
      cachedAt: cachedAt.toISOString(),
      age: Date.now() - cachedAt.getTime(),
    });
  }

  onMismatch(key: string, expected: string, received: string): void {
    this.logger.warn({
      event: 'fingerprint_mismatch',
      key,
      expected,
      received,
    });
  }
}
