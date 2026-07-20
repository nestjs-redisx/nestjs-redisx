/**
 * Service for initializing the @WithCircuitBreaker decorator with lazy service
 * injection.
 *
 * Runs on module initialization and registers a getter that provides access to
 * CircuitBreakerService for the decorator's proxy logic.
 */

import { Injectable, OnModuleInit, Inject, Logger } from '@nestjs/common';

import { CIRCUIT_BREAKER_SERVICE } from '../../shared/constants';
import { registerCircuitBreakerServiceGetter } from '../../api/decorators/with-circuit-breaker.decorator';
import { ICircuitBreakerService } from '../ports/circuit-breaker-service.port';

@Injectable()
export class CircuitBreakerDecoratorInitializerService implements OnModuleInit {
  private readonly logger = new Logger(CircuitBreakerDecoratorInitializerService.name);

  constructor(
    @Inject(CIRCUIT_BREAKER_SERVICE)
    private readonly circuitBreakerService: ICircuitBreakerService,
  ) {}

  /**
   * Registers the CircuitBreakerService getter for the @WithCircuitBreaker decorator.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async onModuleInit(): Promise<void> {
    this.logger.debug('Registering CircuitBreakerService getter for @WithCircuitBreaker decorator');
    registerCircuitBreakerServiceGetter(() => this.circuitBreakerService);
    this.logger.log('@WithCircuitBreaker decorator initialized and ready to use');
  }
}
