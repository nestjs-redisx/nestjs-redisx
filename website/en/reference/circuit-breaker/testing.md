---
title: 'Testing Guide — Circuit Breaker Plugin | NestJS RedisX'
description: 'Test NestJS code guarded by the circuit breaker: unit-test the pure state machine, mock CircuitBreakerService, or run the real plugin on the in-memory driver.'
---

# Testing

There are three levels, from fastest to most realistic.

## 1. Unit-test the pure state machine

`CircuitBreakerState` is pure and time-injected — pass explicit `now` values, no Redis, no fake timers:

```typescript
import { describe, it, expect } from 'vitest';
import { CircuitBreakerState } from '@nestjs-redisx/circuit-breaker';

describe('breaker policy', () => {
  it('trips after the threshold and recovers after cooldown', () => {
    const cb = new CircuitBreakerState({
      failureThreshold: 2,
      windowMs: 1000,
      openDurationMs: 5000,
      halfOpenMaxCalls: 1,
      successThreshold: 1,
    });

    cb.recordFailure(100);
    cb.recordFailure(200);
    expect(cb.snapshot(200).state).toBe('open');

    // still open before the cooldown, half-open after
    expect(cb.canRequest(300)).toBe(false);
    expect(cb.canRequest(200 + 5000)).toBe(true);

    cb.recordSuccess(200 + 5000);
    expect(cb.snapshot(200 + 5000).state).toBe('closed');
  });
});
```

## 2. Mock `CircuitBreakerService`

When unit-testing a service that injects `CIRCUIT_BREAKER_SERVICE`, provide a stub:

```typescript
import { Test } from '@nestjs/testing';
import { CIRCUIT_BREAKER_SERVICE, type ICircuitBreakerService } from '@nestjs-redisx/circuit-breaker';
import { describe, it, expect, vi, type MockedObject } from 'vitest';

describe('UsersService', () => {
  it('runs the guarded function', async () => {
    const breaker: Partial<ICircuitBreakerService> = {
      // pass calls straight through in unit tests
      execute: vi.fn(async (_key, fn) => fn()),
      getState: vi.fn(),
      reset: vi.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [UsersService, { provide: CIRCUIT_BREAKER_SERVICE, useValue: breaker }],
    }).compile();

    const service = module.get(UsersService);
    await service.getUser('42');
    expect(breaker.execute).toHaveBeenCalled();
  });
});
```

## 3. Run the real plugin on the in-memory driver (no Redis)

`@nestjs-redisx/testing` provides an in-memory Redis driver that runs the **real** plugin — including the Lua scripts — so you can exercise the full closed → open → half-open → closed cycle without a Redis server:

```typescript
import { Test } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import { MEMORY_DRIVER_TYPE } from '@nestjs-redisx/testing';
import { CircuitBreakerPlugin, CIRCUIT_BREAKER_SERVICE, CircuitBreakerOpenError, type ICircuitBreakerService } from '@nestjs-redisx/circuit-breaker';
import { describe, it, expect } from 'vitest';

describe('breaker on the memory driver', () => {
  it('opens after failures and rejects fast', async () => {
    const app = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: 'x', port: 1 },
          global: { driver: MEMORY_DRIVER_TYPE },
          plugins: [new CircuitBreakerPlugin({ failureThreshold: 2, openDurationMs: 1000 })],
        }),
      ],
    }).compile();
    await app.init();
    const cb = app.get<ICircuitBreakerService>(CIRCUIT_BREAKER_SERVICE);

    const fail = () => Promise.reject(new Error('down'));
    await expect(cb.execute('dep', fail)).rejects.toThrow();
    await expect(cb.execute('dep', fail)).rejects.toThrow();

    expect((await cb.getState('dep')).state).toBe('open');
    await expect(cb.execute('dep', () => Promise.resolve('x'))).rejects.toBeInstanceOf(CircuitBreakerOpenError);

    await app.close();
  });
});
```

::: tip Time-dependent transitions
The distributed store reads time via `Date.now()`, so tests that cross the OPEN cooldown either wait for a small `openDurationMs` or assert the pre-cooldown behaviour. The pure `CircuitBreakerState` (level 1) needs no waiting — pass the `now` you want.
:::
