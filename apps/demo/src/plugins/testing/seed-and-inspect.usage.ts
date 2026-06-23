import { Injectable, Inject } from '@nestjs/common';
import { REDIS_DRIVER, IRedisDriver } from '@nestjs-redisx/core';
import { MemoryRedisAdapter } from '@nestjs-redisx/testing';

/**
 * In tests you sometimes need to seed Redis state before exercising code, or
 * assert on the raw value it wrote. Cast the injected driver to
 * `MemoryRedisAdapter` and use `getStore()` to reach the in-memory keyspace.
 */
@Injectable()
export class StoreInspector {
  constructor(@Inject(REDIS_DRIVER) private readonly driver: IRedisDriver) {}

  private get store(): ReturnType<MemoryRedisAdapter['getStore']> {
    return (this.driver as MemoryRedisAdapter).getStore();
  }

  /** Seed a string key directly into the keyspace before the code under test runs. */
  seed(key: string, value: string): void {
    this.store.writeString(key, value);
  }

  /** Read back the raw value the code under test wrote. */
  read(key: string): string | undefined {
    return this.store.read(key, 'string');
  }

  /** Reset all keys between test cases. */
  reset(): void {
    this.store.flush();
  }
}
