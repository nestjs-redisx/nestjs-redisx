export interface ISpan {
  readonly spanId: string;
  readonly traceId: string;

  setAttribute(key: string, value: unknown): this;
  setAttributes(attributes: Record<string, unknown>): this;
  addEvent(name: string, attributes?: Record<string, unknown>): this;
  recordException(error: Error): this;
  setStatus(status: 'OK' | 'ERROR'): this;
  end(): void;
}
