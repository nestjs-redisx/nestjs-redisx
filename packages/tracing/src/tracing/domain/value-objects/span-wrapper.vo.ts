import type { Span } from '@opentelemetry/api';
import { SpanStatusCode } from '@opentelemetry/api';

import type { ISpan } from '../../application/ports/span.port';

export class SpanWrapper implements ISpan {
  constructor(private readonly span: Span) {}

  get spanId(): string {
    return this.span.spanContext().spanId;
  }

  get traceId(): string {
    return this.span.spanContext().traceId;
  }

  setAttribute(key: string, value: unknown): this {
    this.span.setAttribute(key, value as never);
    return this;
  }

  setAttributes(attributes: Record<string, unknown>): this {
    this.span.setAttributes(attributes as never);
    return this;
  }

  addEvent(name: string, attributes?: Record<string, unknown>): this {
    this.span.addEvent(name, attributes as never);
    return this;
  }

  recordException(error: Error): this {
    this.span.recordException(error);
    return this;
  }

  setStatus(status: 'OK' | 'ERROR'): this {
    this.span.setStatus({
      code: status === 'OK' ? SpanStatusCode.OK : SpanStatusCode.ERROR,
    });
    return this;
  }

  end(): void {
    this.span.end();
  }

  /**
   * Get underlying OpenTelemetry span (for internal use).
   */
  unwrap(): Span {
    return this.span;
  }
}
