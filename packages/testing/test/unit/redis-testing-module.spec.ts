import { describe, it, expect, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { REDIS_DRIVER } from '@nestjs-redisx/core';

import { RedisTestingModule, MemoryRedisAdapter } from '../../src';

/**
 * Unit tests for the RedisTestingModule wrapper: it must boot RedisModule with
 * the in-memory driver for both forRoot and forRootAsync, with or without
 * explicit options. (Lives under test/unit so it runs in the root CI suite too.)
 */
describe('RedisTestingModule', () => {
  let app: TestingModule | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('forRoot boots the in-memory driver with no options', async () => {
    app = await Test.createTestingModule({ imports: [RedisTestingModule.forRoot()] }).compile();
    await app.init();
    expect(app.get(REDIS_DRIVER)).toBeInstanceOf(MemoryRedisAdapter);
  });

  it('forRoot honours an explicit (ignored) clients block and global options', async () => {
    app = await Test.createTestingModule({
      imports: [RedisTestingModule.forRoot({ clients: { type: 'single', host: 'x', port: 1 }, global: { keyPrefix: 'test:' } })],
    }).compile();
    await app.init();
    expect(app.get(REDIS_DRIVER)).toBeInstanceOf(MemoryRedisAdapter);
  });

  it('forRootAsync forces the in-memory driver, keeping the user factory config', async () => {
    app = await Test.createTestingModule({
      imports: [RedisTestingModule.forRootAsync({ useFactory: () => ({ clients: { type: 'single', host: 'x', port: 1 } }) })],
    }).compile();
    await app.init();
    expect(app.get(REDIS_DRIVER)).toBeInstanceOf(MemoryRedisAdapter);
  });

  it('forRootAsync works without a user factory', async () => {
    app = await Test.createTestingModule({ imports: [RedisTestingModule.forRootAsync({})] }).compile();
    await app.init();
    expect(app.get(REDIS_DRIVER)).toBeInstanceOf(MemoryRedisAdapter);
  });
});
