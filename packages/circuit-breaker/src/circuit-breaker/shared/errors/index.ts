export class InvalidCircuitBreakerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCircuitBreakerConfigError';
  }
}
