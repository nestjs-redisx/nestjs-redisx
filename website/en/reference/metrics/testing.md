---
title: Testing
description: Testing metrics collection and custom metrics
---

# Testing

How to test services that use metrics.

::: info Vitest, not Jest
NestJS RedisX uses **Vitest** for all tests. Use `vi.fn()` instead of `jest.fn()`, and `MockedObject<T>` from `vitest` for typed mocks. All test examples follow the **Given-When-Then** pattern.
:::

## Mock MetricsService

Create a mock of `IMetricsService` for unit tests:

```typescript
import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { Test } from '@nestjs/testing';
import { METRICS_SERVICE, type IMetricsService } from '@nestjs-redisx/metrics';

describe('OrderService', () => {
  let service: OrderService;
  let metrics: MockedObject<IMetricsService>;

  beforeEach(async () => {
    metrics = {
      incrementCounter: vi.fn(),
      observeHistogram: vi.fn(),
      startTimer: vi.fn(),
      setGauge: vi.fn(),
      incrementGauge: vi.fn(),
      decrementGauge: vi.fn(),
      getMetrics: vi.fn(),
      getMetricsJson: vi.fn(),
      registerCounter: vi.fn(),
      registerHistogram: vi.fn(),
      registerGauge: vi.fn(),
    } as unknown as MockedObject<IMetricsService>;

    const module = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: METRICS_SERVICE, useValue: metrics },
      ],
    }).compile();

    service = module.get(OrderService);
  });
});
```

## Testing Counter Increments

Verify that business operations increment the correct counters with expected labels:

```typescript
describe('OrderService', () => {
  let service: OrderService;
  let metrics: MockedObject<IMetricsService>;

  beforeEach(async () => {
    metrics = {
      incrementCounter: vi.fn(),
      observeHistogram: vi.fn(),
      startTimer: vi.fn(),
      setGauge: vi.fn(),
      incrementGauge: vi.fn(),
      decrementGauge: vi.fn(),
      getMetrics: vi.fn(),
      getMetricsJson: vi.fn(),
      registerCounter: vi.fn(),
      registerHistogram: vi.fn(),
      registerGauge: vi.fn(),
    } as unknown as MockedObject<IMetricsService>;

    service = new OrderService(metrics, orderRepository);
  });

  it('should increment order counter after creating an order', async () => {
    // Given
    const order = { id: '1', status: 'completed', paymentMethod: 'credit_card' };

    // When
    await service.createOrder(order);

    // Then
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'orders_created_total',
      { status: 'completed', payment_method: 'credit_card' },
    );
  });

  it('should increment error counter on failure', async () => {
    // Given
    const order = { id: '2', status: 'failed', paymentMethod: 'debit' };

    // When
    await service.createOrder(order);

    // Then
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'orders_failed_total',
      { payment_method: 'debit' },
    );
  });
});
```

## Testing Histogram Observations

Test the `startTimer()` pattern — mock it to return a spy function, then verify the timer was stopped:

```typescript
describe('OrderService.processPayment', () => {
  it('should measure payment processing duration', async () => {
    // Given
    const stopTimer = vi.fn();
    metrics.startTimer.mockReturnValue(stopTimer);

    // When
    await service.processPayment('order-123', 99.99);

    // Then
    expect(metrics.startTimer).toHaveBeenCalledWith(
      'payment_duration_seconds',
      { method: 'credit_card' },
    );
    expect(stopTimer).toHaveBeenCalled();
  });

  it('should stop timer even on failure', async () => {
    // Given
    const stopTimer = vi.fn();
    metrics.startTimer.mockReturnValue(stopTimer);
    paymentGateway.charge.mockRejectedValue(new Error('Declined'));

    // When / Then
    await expect(service.processPayment('order-123', 99.99))
      .rejects.toThrow('Declined');
    expect(stopTimer).toHaveBeenCalled();
  });
});
```

## Testing Gauge Updates

Test `setGauge`, `incrementGauge`, and `decrementGauge` on a service that tracks active users:

```typescript
describe('ActiveUsersTracker', () => {
  let tracker: ActiveUsersTracker;
  let metrics: MockedObject<IMetricsService>;

  beforeEach(() => {
    metrics = {
      setGauge: vi.fn(),
      incrementGauge: vi.fn(),
      decrementGauge: vi.fn(),
      registerGauge: vi.fn(),
    } as unknown as MockedObject<IMetricsService>;

    tracker = new ActiveUsersTracker(metrics);
  });

  it('should increment gauge on user login', () => {
    // Given
    const userId = 'user-123';

    // When
    tracker.onLogin(userId);

    // Then
    expect(metrics.incrementGauge).toHaveBeenCalledWith(
      'active_users',
      undefined,
      1,
    );
  });

  it('should decrement gauge on user logout', () => {
    // Given
    const userId = 'user-123';

    // When
    tracker.onLogout(userId);

    // Then
    expect(metrics.decrementGauge).toHaveBeenCalledWith(
      'active_users',
      undefined,
      1,
    );
  });

  it('should set gauge to exact value for queue size', () => {
    // Given
    const queueSize = 42;

    // When
    tracker.updateQueueSize(queueSize);

    // Then
    expect(metrics.setGauge).toHaveBeenCalledWith('queue_size', 42);
  });
});
```

## Testing Custom Metric Registration

Verify that metrics are registered during module initialization:

```typescript
describe('ApiMetrics.onModuleInit', () => {
  let apiMetrics: ApiMetrics;
  let metrics: MockedObject<IMetricsService>;

  beforeEach(() => {
    metrics = {
      registerCounter: vi.fn(),
      registerHistogram: vi.fn(),
      registerGauge: vi.fn(),
    } as unknown as MockedObject<IMetricsService>;

    apiMetrics = new ApiMetrics(metrics);
  });

  it('should register all required metrics on init', () => {
    // When
    apiMetrics.onModuleInit();

    // Then
    expect(metrics.registerCounter).toHaveBeenCalledWith(
      'http_requests_total',
      'Total HTTP requests',
      ['method', 'endpoint', 'status'],
    );

    expect(metrics.registerHistogram).toHaveBeenCalledWith(
      'http_request_duration_seconds',
      'HTTP request duration',
      ['method', 'endpoint'],
      expect.any(Array),
    );

    expect(metrics.registerGauge).toHaveBeenCalledWith(
      'active_connections',
      'Active connections',
      ['type'],
    );
  });
});
```

## Testing /metrics Endpoint

Integration test using `supertest` to verify the Prometheus endpoint:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { RedisModule } from '@nestjs-redisx/core';
import { MetricsPlugin, MetricsController } from '@nestjs-redisx/metrics';

describe('GET /metrics', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: 'localhost', port: 6379 },
          plugins: [
            new MetricsPlugin({ enabled: true, exposeEndpoint: true }),
          ],
        }),
      ],
      controllers: [MetricsController],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should return Prometheus format metrics', async () => {
    // When
    const response = await request(app.getHttpServer())
      .get('/metrics')
      .expect(200);

    // Then
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('# HELP');
    expect(response.text).toContain('# TYPE');
  });
});
```

## Integration Tests

Full setup with real Redis to verify metrics are collected end-to-end:

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { MetricsPlugin, METRICS_SERVICE, type IMetricsService } from '@nestjs-redisx/metrics';

describe('Metrics (integration)', () => {
  let app: INestApplication;
  let metrics: IMetricsService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: 'localhost', port: 6379 },
          plugins: [
            new MetricsPlugin({ enabled: true }),
          ],
        }),
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
    metrics = app.get(METRICS_SERVICE);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should register and increment a counter', async () => {
    // Given
    metrics.registerCounter('test_orders_total', 'Test counter', ['status']);

    // When
    metrics.incrementCounter('test_orders_total', { status: 'completed' });
    metrics.incrementCounter('test_orders_total', { status: 'completed' });

    // Then
    const output = await metrics.getMetrics();
    expect(output).toContain('test_orders_total');
    expect(output).toContain('status="completed"');
  });

  it('should observe histogram values', async () => {
    // Given
    metrics.registerHistogram('test_duration_seconds', 'Test histogram');

    // When
    metrics.observeHistogram('test_duration_seconds', 0.25);

    // Then
    const output = await metrics.getMetrics();
    expect(output).toContain('test_duration_seconds');
  });

  it('should track gauge values', async () => {
    // Given
    metrics.registerGauge('test_active_jobs', 'Test gauge');

    // When
    metrics.setGauge('test_active_jobs', 5);

    // Then
    const output = await metrics.getMetrics();
    expect(output).toContain('test_active_jobs');
  });
});
```

::: warning Integration tests require Redis
Integration tests need a running Redis instance. Use `docker-compose up -d` from the project root.
:::

## Best Practices

### Do
- Mock `IMetricsService` via `METRICS_SERVICE` token — don't test prom-client internals
- Test **behavior** (counter incremented, timer stopped) not **metric values**
- Use `startTimer` mock that returns a spy to verify timer completion
- Use Given-When-Then comments in every test
- Test that metrics are registered in `onModuleInit`

### Don't
- Don't import `prom-client` directly in tests — mock via the service interface
- Don't assert exact metric output format — it may change between versions
- Don't use `jest.fn()` — use `vi.fn()` (Vitest)
- Don't forget to test timer completion in error paths (finally blocks)

## Next Steps

- [Recipes](./recipes) — Real-world metrics patterns
- [Troubleshooting](./troubleshooting) — Debug issues
