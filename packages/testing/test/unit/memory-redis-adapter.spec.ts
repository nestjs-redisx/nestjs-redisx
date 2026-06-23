import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { MemoryRedisAdapter } from '../../src/memory/infrastructure/adapters/memory-redis.adapter';
import { MemoryStore } from '../../src/memory/domain/store/memory-store';

/**
 * Unit tests for the MemoryRedisAdapter: lifecycle, command execution through the
 * inherited high-level API, pipelines, and transactions.
 */
describe('MemoryRedisAdapter', () => {
  let adapter: MemoryRedisAdapter;

  beforeEach(async () => {
    adapter = new MemoryRedisAdapter({ type: 'single', host: 'x', port: 1 });
    await adapter.connect();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  it('connects and reports connected state', () => {
    expect(adapter.isConnected()).toBe(true);
  });

  it('exposes the backing store', () => {
    expect(adapter.getStore()).toBeInstanceOf(MemoryStore);
  });

  it('runs string commands through the inherited high-level API', async () => {
    expect(await adapter.set('k', 'v')).toBe('OK');
    expect(await adapter.get('k')).toBe('v');
    expect(await adapter.del('k')).toBe(1);
    expect(await adapter.get('k')).toBeNull();
  });

  it('runs hash commands', async () => {
    await adapter.hset('h', 'a', '1');
    expect(await adapter.hgetall('h')).toEqual({ a: '1' });
  });

  it('runs Lua via eval / scriptLoad / evalsha', async () => {
    await adapter.set('k', 'v');
    const script = "return redis.call('GET', KEYS[1])";
    expect(await adapter.eval(script, ['k'], [])).toBe('v');
    const sha = await adapter.scriptLoad(script);
    expect(await adapter.evalsha(sha, ['k'], [])).toBe('v');
  });

  describe('pipeline', () => {
    it('buffers and replays commands, returning [error, result] tuples', async () => {
      const results = await adapter.pipeline().set('a', '1').get('a').incr('n').exec();
      expect(results).toEqual([
        [null, 'OK'],
        [null, '1'],
        [null, 1],
      ]);
    });

    it('captures per-command errors without aborting the batch', async () => {
      await adapter.set('s', 'notnumber');
      const results = await adapter.pipeline().incr('s').get('s').exec();
      expect(results[0]![0]).toBeInstanceOf(Error);
      expect(results[1]).toEqual([null, 'notnumber']);
    });

    it('supports the full buffered command surface', async () => {
      const results = await adapter.pipeline().mset({ a: '1', b: '2' }).mget('a', 'b').expire('a', 100).ttl('a').incrby('n', 5).hset('h', 'f', 'v').hmset('h', { g: 'w' }).hget('h', 'f').hgetall('h').lpush('l', 'x').rpush('l', 'y').sadd('st', 'm').srem('st', 'm').zadd('z', 1, 'a').zrem('z', 'a').exec();
      expect(results).toHaveLength(15);
      expect(results.every(([err]) => err === null)).toBe(true);
    });
  });

  describe('multi / transaction', () => {
    it('executes queued commands on exec', async () => {
      const results = await adapter.multi().set('a', '1').get('a').exec();
      expect(results).toEqual([
        [null, 'OK'],
        [null, '1'],
      ]);
    });

    it('discard clears the queue', async () => {
      const tx = adapter.multi();
      tx.set('a', '1');
      tx.discard();
      const results = await tx.exec();
      expect(results).toEqual([]);
    });
  });
});
