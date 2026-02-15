---
title: Testing
description: Testing traced services and span creation
---

# Testing

How to test services that use tracing.

::: info Vitest, not Jest
NestJS RedisX uses **Vitest** for all tests. Use `vi.fn()` instead of `jest.fn()`, and `MockedObject<T>` from `vitest` for typed mocks. All test examples follow the **Given-When-Then** pattern.
:::

## Mock TracingService

Create a mock of `ITracingService` for unit tests. The key is that `withSpan` must actually call the function argument so your business logic executes:

```typescript
import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { Test } from '@nestjs/testing';
import { TRACING_SERVICE, type ITracingService, type ISpan } from '@nestjs-redisx/tracing';

function createMockSpan(): MockedObject<ISpan> {
  const span: MockedObject<ISpan> = {
    spanId: 'mock-span-id',
    traceId: 'mock-trace-id',
    setAttribute: vi.fn().mockReturnThis(),
    setAttributes: vi.fn().mockReturnThis(),
    addEvent: vi.fn().mockReturnThis(),
    recordException: vi.fn().mockReturnThis(),
    setStatus: vi.fn().mockReturnThis(),
    end: vi.fn(),
  } as unknown as MockedObject<ISpan>;
  return span;
}

describe('OrderService', () => {
  let service: OrderService;
  let tracing: MockedObject<ITracingService>;
  let mockSpan: MockedObject<ISpan>;

  beforeEach(async () => {
    mockSpan = createMockSpan();

    tracing = {
      startSpan: vi.fn().mockReturnValue(mockSpan),
      getCurrentSpan: vi.fn().mockReturnValue(mockSpan),
      withSpan: vi.fn().mockImplementation(async (_name, fn) => fn()),
      addEvent: vi.fn(),
      setAttribute: vi.fn(),
      recordException: vi.fn(),
    } as unknown as MockedObject<ITracingService>;

    const module = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: TRACING_SERVICE, useValue: tracing },
      ],
    }).compile();

    service = module.get(OrderService);
  });
});
```

## Testing withSpan

Verify that `withSpan` is called with the correct span name, the inner function executes, and attributes are recorded:

```typescript
describe('OrderService.createOrder', () => {
  it('should create a span for order creation', async () => {
    // Given
    const dto = { customerId: 'c1', total: 99.99, items: ['item-1'] };
    orderRepo.create.mockResolvedValue({ id: 'order-1', ...dto });

    // When
    const result = await service.createOrder(dto);

    // Then
    expect(tracing.withSpan).toHaveBeenCalledWith(
      'order.create',
      expect.any(Function),
    );
    expect(result.id).toBe('order-1');
  });

  it('should set attributes on the span', async () => {
    // Given
    const dto = { customerId: 'c1', total: 149.99, items: ['a', 'b'] };
    orderRepo.create.mockResolvedValue({ id: 'order-2', ...dto });

    // When
    await service.createOrder(dto);

    // Then
    expect(tracing.setAttribute).toHaveBeenCalledWith('order.total', 149.99);
    expect(tracing.setAttribute).toHaveBeenCalledWith('order.items_count', 2);
    expect(tracing.setAttribute).toHaveBeenCalledWith('customer.id', 'c1');
  });

  it('should add events during processing', async () => {
    // Given
    const dto = { customerId: 'c1', total: 50, items: ['item-1'] };
    orderRepo.create.mockResolvedValue({ id: 'order-3', ...dto });

    // When
    await service.createOrder(dto);

    // Then
    expect(tracing.addEvent).toHaveBeenCalledWith('validation.started');
    expect(tracing.addEvent).toHaveBeenCalledWith('validation.completed');
  });
});
```

## Testing startSpan / end

For manual span management, verify that `startSpan` is called and `span.end()` is always called in the `finally` block:

```typescript
describe('ReportService', () => {
  it('should start and end span for report generation', async () => {
    // Given
    const reportData = { month: '2025-01', userId: 'u-1' };

    // When
    await reportService.generateReport(reportData);

    // Then
    expect(tracing.startSpan).toHaveBeenCalledWith('report.generate');
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('should end span even when generation fails', async () => {
    // Given
    reportGenerator.generate.mockRejectedValue(new Error('Template not found'));

    // When / Then
    await expect(reportService.generateReport({ month: '2025-01' }))
      .rejects.toThrow('Template not found');
    expect(mockSpan.end).toHaveBeenCalled();
  });
});
```

## Testing Error Recording

Verify that when the inner function throws, `recordException` is called and the error is re-thrown:

```typescript
describe('OrderService error handling', () => {
  it('should record exception when payment fails', async () => {
    // Given
    const dto = { customerId: 'c1', total: 99.99, items: ['item-1'] };
    orderRepo.create.mockResolvedValue({ id: 'order-1', ...dto });
    paymentService.charge.mockRejectedValue(new Error('Card declined'));

    // When / Then
    await expect(service.createOrder(dto))
      .rejects.toThrow('Card declined');
    expect(tracing.recordException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Card declined' }),
    );
  });

  it('should add failure event with error details', async () => {
    // Given
    const error = new Error('Insufficient funds');
    error.name = 'PaymentError';
    paymentService.charge.mockRejectedValue(error);

    // When
    await service.createOrder(dto).catch(() => {});

    // Then
    expect(tracing.addEvent).toHaveBeenCalledWith(
      'payment.failed',
      expect.objectContaining({
        'error.type': 'PaymentError',
        'error.message': 'Insufficient funds',
      }),
    );
  });
});
```

## Testing Span Attributes

Verify that `setAttribute` is called with expected key/value pairs during business logic:

```typescript
describe('UserService span attributes', () => {
  it('should set user attributes on the span', async () => {
    // Given
    const userId = 'user-123';
    userRepo.findById.mockResolvedValue({
      id: userId,
      role: 'admin',
      plan: 'enterprise',
    });

    // When
    await userService.getUser(userId);

    // Then
    expect(tracing.setAttribute).toHaveBeenCalledWith('user.id', 'user-123');
    expect(tracing.setAttribute).toHaveBeenCalledWith('user.role', 'admin');
  });

  it('should set cache hit attribute', async () => {
    // Given
    cache.get.mockResolvedValue({ id: 'user-123', name: 'John' });

    // When
    await userService.getUser('user-123');

    // Then
    expect(tracing.setAttribute).toHaveBeenCalledWith('cache.hit', true);
  });

  it('should set cache miss attribute on miss', async () => {
    // Given
    cache.get.mockResolvedValue(null);
    userRepo.findById.mockResolvedValue({ id: 'user-123' });

    // When
    await userService.getUser('user-123');

    // Then
    expect(tracing.setAttribute).toHaveBeenCalledWith('cache.hit', false);
  });
});
```

## Integration Tests

Full setup with real Redis to verify spans are created:

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { TracingPlugin, TRACING_SERVICE, type ITracingService } from '@nestjs-redisx/tracing';

describe('Tracing (integration)', () => {
  let app: INestApplication;
  let tracing: ITracingService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: 'localhost', port: 6379 },
          plugins: [
            new TracingPlugin({
              enabled: true,
              exporter: { type: 'console' },
            }),
          ],
        }),
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
    tracing = app.get(TRACING_SERVICE);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create and complete a span via withSpan', async () => {
    // Given
    let executed = false;

    // When
    await tracing.withSpan('test.operation', async () => {
      executed = true;
      tracing.setAttribute('test.key', 'test-value');
      tracing.addEvent('test.event');
    });

    // Then
    expect(executed).toBe(true);
  });

  it('should create manual spans', () => {
    // When
    const span = tracing.startSpan('test.manual');

    // Then
    expect(span).toBeDefined();
    expect(span.spanId).toBeDefined();
    expect(span.traceId).toBeDefined();

    span.setAttribute('key', 'value');
    span.end();
  });

  it('should propagate context in nested spans', async () => {
    // When
    await tracing.withSpan('parent', async () => {
      const parentSpan = tracing.getCurrentSpan();

      await tracing.withSpan('child', async () => {
        const childSpan = tracing.getCurrentSpan();

        // Then — child is in the same trace
        expect(childSpan).toBeDefined();
        expect(parentSpan).toBeDefined();
      });
    });
  });
});
```

::: warning Integration tests require Redis
Integration tests need a running Redis instance. Use `docker-compose up -d` from the project root.
:::

## Best Practices

### Do
- Mock `ITracingService` via `TRACING_SERVICE` token — don't test OpenTelemetry internals
- Make `withSpan` mock actually call the function: `vi.fn().mockImplementation(async (_name, fn) => fn())`
- Test that `span.end()` is called in `finally` blocks for manual spans
- Test error recording — verify `recordException` is called on failures
- Use Given-When-Then comments in every test

### Don't
- Don't import `@opentelemetry/api` directly in unit tests — mock via the service interface
- Don't test span IDs or trace IDs for specific values — they're random
- Don't use `jest.fn()` — use `vi.fn()` (Vitest)
- Don't skip testing error paths — tracing is especially valuable for debugging failures

## Next Steps

- [Recipes](./recipes) — Real-world tracing patterns
- [Troubleshooting](./troubleshooting) — Debug issues
