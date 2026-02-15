import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnEvent } from '@nestjs/event-emitter';
import { AlertService } from './types';

@Injectable()
export class IdempotencyMonitor {
  constructor(private eventEmitter: EventEmitter2) {}

  onNewRequest(key: string): void {
    this.eventEmitter.emit('idempotency.new', { key });
  }

  onDuplicate(key: string, age: number): void {
    this.eventEmitter.emit('idempotency.duplicate', { key, age });
  }

  onMismatch(key: string): void {
    this.eventEmitter.emit('idempotency.mismatch', { key });
  }
}

// Listen to events
@Injectable()
export class IdempotencyListener {
  constructor(private readonly alertService: AlertService) {}

  @OnEvent('idempotency.duplicate')
  handleDuplicate(payload: { key: string; age: number }): void {
    if (payload.age < 1000) {
      console.warn(`Very fast duplicate for ${payload.key}`);
    }
  }

  @OnEvent('idempotency.mismatch')
  handleMismatch(payload: { key: string }): void {
    // Alert on fingerprint mismatch
    this.alertService.send(`Fingerprint mismatch: ${payload.key}`);
  }
}
