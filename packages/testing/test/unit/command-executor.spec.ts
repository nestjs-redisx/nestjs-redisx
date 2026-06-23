import { describe, it, expect, beforeEach } from 'vitest';

import { CommandExecutor } from '../../src/memory/application/services/command-executor.service';
import { MemoryStore } from '../../src/memory/domain/store/memory-store';
import { MemoryDriverError } from '../../src/shared/errors';

/**
 * Unit tests for the in-memory command executor: every supported command branch.
 */
describe('CommandExecutor', () => {
  let store: MemoryStore;
  let ex: CommandExecutor;
  const run = (cmd: string, ...args: unknown[]): unknown => ex.execute(cmd, args);

  beforeEach(() => {
    store = new MemoryStore();
    ex = new CommandExecutor(store);
  });

  describe('connection / server', () => {
    it('PING returns PONG, or echoes its argument', () => {
      expect(run('PING')).toBe('PONG');
      expect(run('PING', 'hello')).toBe('hello');
    });

    it('DBSIZE counts live keys', () => {
      run('SET', 'a', '1');
      run('SET', 'b', '2');
      expect(run('DBSIZE')).toBe(2);
    });

    it('FLUSHDB / FLUSHALL clear the keyspace', () => {
      run('SET', 'a', '1');
      expect(run('FLUSHDB')).toBe('OK');
      expect(run('DBSIZE')).toBe(0);
      run('SET', 'a', '1');
      expect(run('FLUSHALL')).toBe('OK');
      expect(run('DBSIZE')).toBe(0);
    });

    it('is case-insensitive on the command name', () => {
      expect(run('ping')).toBe('PONG');
    });
  });

  describe('strings', () => {
    it('SET/GET round-trips and GET returns null when missing', () => {
      expect(run('SET', 'k', 'v')).toBe('OK');
      expect(run('GET', 'k')).toBe('v');
      expect(run('GET', 'missing')).toBeNull();
    });

    it('SET NX only sets when absent', () => {
      expect(run('SET', 'k', 'v1', 'NX')).toBe('OK');
      expect(run('SET', 'k', 'v2', 'NX')).toBeNull();
      expect(run('GET', 'k')).toBe('v1');
    });

    it('SET XX only sets when present', () => {
      expect(run('SET', 'k', 'v', 'XX')).toBeNull();
      run('SET', 'k', 'v1');
      expect(run('SET', 'k', 'v2', 'XX')).toBe('OK');
      expect(run('GET', 'k')).toBe('v2');
    });

    it('SET GET returns the previous value', () => {
      run('SET', 'k', 'old');
      expect(run('SET', 'k', 'new', 'GET')).toBe('old');
      expect(run('SET', 'fresh', 'x', 'GET')).toBeNull();
    });

    it('SET EX / PX set a TTL', () => {
      run('SET', 'k', 'v', 'EX', 100);
      expect(run('TTL', 'k')).toBe(100);
      run('SET', 'p', 'v', 'PX', 5000);
      expect(run('PTTL', 'p')).toBeGreaterThan(0);
    });

    it('SETEX and SETNX', () => {
      expect(run('SETEX', 'k', 50, 'v')).toBe('OK');
      expect(run('TTL', 'k')).toBe(50);
      expect(run('SETNX', 'k', 'x')).toBe(0);
      expect(run('SETNX', 'fresh', 'x')).toBe(1);
    });

    it('DEL / UNLINK count removed keys', () => {
      run('SET', 'a', '1');
      run('SET', 'b', '2');
      expect(run('DEL', 'a', 'b', 'missing')).toBe(2);
      run('SET', 'c', '1');
      expect(run('UNLINK', 'c')).toBe(1);
    });

    it('EXISTS counts present keys (with repeats)', () => {
      run('SET', 'a', '1');
      expect(run('EXISTS', 'a', 'a', 'b')).toBe(2);
    });

    it('INCR / INCRBY / DECR / DECRBY', () => {
      expect(run('INCR', 'n')).toBe(1);
      expect(run('INCRBY', 'n', 5)).toBe(6);
      expect(run('DECR', 'n')).toBe(5);
      expect(run('DECRBY', 'n', 2)).toBe(3);
    });

    it('INCR preserves an existing TTL', () => {
      run('SET', 'n', '1', 'EX', 100);
      run('INCR', 'n');
      expect(run('TTL', 'n')).toBeGreaterThan(0);
    });

    it('INCR on a non-numeric value throws', () => {
      run('SET', 'n', 'abc');
      expect(() => run('INCR', 'n')).toThrow(MemoryDriverError);
    });

    it('APPEND returns the new length and preserves TTL', () => {
      expect(run('APPEND', 'k', 'ab')).toBe(2);
      run('EXPIRE', 'k', 100);
      expect(run('APPEND', 'k', 'cd')).toBe(4);
      expect(run('GET', 'k')).toBe('abcd');
      expect(run('TTL', 'k')).toBeGreaterThan(0);
    });

    it('STRLEN', () => {
      run('SET', 'k', 'hello');
      expect(run('STRLEN', 'k')).toBe(5);
      expect(run('STRLEN', 'missing')).toBe(0);
    });

    it('MGET / MSET', () => {
      expect(run('MSET', 'a', '1', 'b', '2')).toBe('OK');
      expect(run('MGET', 'a', 'b', 'missing')).toEqual(['1', '2', null]);
    });
  });

  describe('keys / TTL', () => {
    it('EXPIRE / PEXPIRE / PERSIST', () => {
      run('SET', 'k', 'v');
      expect(run('EXPIRE', 'k', 100)).toBe(1);
      expect(run('EXPIRE', 'missing', 100)).toBe(0);
      expect(run('PEXPIRE', 'k', 200000)).toBe(1);
      expect(run('PERSIST', 'k')).toBe(1);
      expect(run('TTL', 'k')).toBe(-1);
    });

    it('EXPIREAT / PEXPIREAT set absolute expiry', () => {
      run('SET', 'k', 'v');
      const future = Math.floor(store.now() / 1000) + 100;
      expect(run('EXPIREAT', 'k', future)).toBe(1);
      expect(run('TTL', 'k')).toBeGreaterThan(0);
      run('SET', 'p', 'v');
      expect(run('PEXPIREAT', 'p', store.now() + 50000)).toBe(1);
    });

    it('TTL / PTTL return -2 for missing, -1 for no expiry', () => {
      expect(run('TTL', 'missing')).toBe(-2);
      expect(run('PTTL', 'missing')).toBe(-2);
      run('SET', 'k', 'v');
      expect(run('TTL', 'k')).toBe(-1);
      expect(run('PTTL', 'k')).toBe(-1);
    });

    it('TYPE reports the data type', () => {
      run('SET', 's', 'v');
      run('HSET', 'h', 'f', 'v');
      expect(run('TYPE', 's')).toBe('string');
      expect(run('TYPE', 'h')).toBe('hash');
      expect(run('TYPE', 'missing')).toBe('none');
    });

    it('KEYS matches glob patterns', () => {
      run('SET', 'user:1', 'a');
      run('SET', 'user:2', 'b');
      run('SET', 'order:1', 'c');
      expect((run('KEYS', 'user:*') as string[]).sort()).toEqual(['user:1', 'user:2']);
      expect(run('KEYS', 'user:?')).toHaveLength(2);
    });

    it('SCAN returns a cursor of 0 and matching keys', () => {
      run('SET', 'a', '1');
      run('SET', 'b', '2');
      const [cursor, keys] = run('SCAN', '0', 'MATCH', '*', 'COUNT', 10) as [string, string[]];
      expect(cursor).toBe('0');
      expect(keys.sort()).toEqual(['a', 'b']);
    });

    it('SCAN without MATCH returns all keys', () => {
      run('SET', 'a', '1');
      const [, keys] = run('SCAN', '0') as [string, string[]];
      expect(keys).toEqual(['a']);
    });
  });

  describe('hashes', () => {
    it('HSET returns added count, HMSET returns OK', () => {
      expect(run('HSET', 'h', 'a', '1', 'b', '2')).toBe(2);
      expect(run('HSET', 'h', 'a', '3')).toBe(0); // overwrite, not added
      expect(run('HMSET', 'h', 'c', '4')).toBe('OK');
    });

    it('HGET / HMGET', () => {
      run('HSET', 'h', 'a', '1', 'b', '2');
      expect(run('HGET', 'h', 'a')).toBe('1');
      expect(run('HGET', 'h', 'missing')).toBeNull();
      expect(run('HMGET', 'h', 'a', 'b', 'missing')).toEqual(['1', '2', null]);
    });

    it('HGETALL returns an object', () => {
      run('HSET', 'h', 'a', '1', 'b', '2');
      expect(run('HGETALL', 'h')).toEqual({ a: '1', b: '2' });
      expect(run('HGETALL', 'missing')).toEqual({});
    });

    it('HDEL removes fields and drops empty hashes', () => {
      run('HSET', 'h', 'a', '1', 'b', '2');
      expect(run('HDEL', 'h', 'a', 'missing')).toBe(1);
      expect(run('HDEL', 'h', 'b')).toBe(1);
      expect(run('EXISTS', 'h')).toBe(0);
      expect(run('HDEL', 'gone', 'a')).toBe(0);
    });

    it('HEXISTS / HLEN / HKEYS / HVALS', () => {
      run('HSET', 'h', 'a', '1', 'b', '2');
      expect(run('HEXISTS', 'h', 'a')).toBe(1);
      expect(run('HEXISTS', 'h', 'z')).toBe(0);
      expect(run('HLEN', 'h')).toBe(2);
      expect((run('HKEYS', 'h') as string[]).sort()).toEqual(['a', 'b']);
      expect((run('HVALS', 'h') as string[]).sort()).toEqual(['1', '2']);
      expect(run('HLEN', 'missing')).toBe(0);
    });

    it('HINCRBY', () => {
      expect(run('HINCRBY', 'h', 'n', 5)).toBe(5);
      expect(run('HINCRBY', 'h', 'n', -2)).toBe(3);
    });
  });

  describe('lists', () => {
    it('LPUSH / RPUSH / LLEN / LRANGE', () => {
      expect(run('RPUSH', 'l', 'a', 'b')).toBe(2);
      expect(run('LPUSH', 'l', 'z')).toBe(3);
      expect(run('LLEN', 'l')).toBe(3);
      expect(run('LRANGE', 'l', 0, -1)).toEqual(['z', 'a', 'b']);
      expect(run('LRANGE', 'l', -2, -1)).toEqual(['a', 'b']);
      expect(run('LLEN', 'missing')).toBe(0);
      expect(run('LRANGE', 'missing', 0, -1)).toEqual([]);
    });

    it('LPOP / RPOP single and with count, dropping empty lists', () => {
      run('RPUSH', 'l', 'a', 'b', 'c', 'd');
      expect(run('LPOP', 'l')).toBe('a');
      expect(run('RPOP', 'l')).toBe('d');
      expect(run('LPOP', 'l', 2)).toEqual(['b', 'c']);
      expect(run('EXISTS', 'l')).toBe(0);
      expect(run('LPOP', 'missing')).toBeNull();
      expect(run('LPOP', 'missing', 2)).toEqual([]);
    });

    it('LINDEX with positive and negative indices', () => {
      run('RPUSH', 'l', 'a', 'b', 'c');
      expect(run('LINDEX', 'l', 0)).toBe('a');
      expect(run('LINDEX', 'l', -1)).toBe('c');
      expect(run('LINDEX', 'l', 99)).toBeNull();
      expect(run('LINDEX', 'missing', 0)).toBeNull();
    });

    it('LREM removes matching elements and drops empty lists', () => {
      run('RPUSH', 'l', 'a', 'b', 'a', 'c', 'a');
      expect(run('LREM', 'l', 0, 'a')).toBe(3);
      expect(run('LRANGE', 'l', 0, -1)).toEqual(['b', 'c']);
      expect(run('LREM', 'missing', 0, 'a')).toBe(0);
      run('RPUSH', 'only', 'x');
      expect(run('LREM', 'only', 0, 'x')).toBe(1);
      expect(run('EXISTS', 'only')).toBe(0);
    });
  });

  describe('sets', () => {
    it('SADD / SREM / SMEMBERS / SISMEMBER / SCARD', () => {
      expect(run('SADD', 's', 'a', 'b', 'a')).toBe(2);
      expect(run('SCARD', 's')).toBe(2);
      expect(run('SISMEMBER', 's', 'a')).toBe(1);
      expect(run('SISMEMBER', 's', 'z')).toBe(0);
      expect((run('SMEMBERS', 's') as string[]).sort()).toEqual(['a', 'b']);
      expect(run('SREM', 's', 'a', 'missing')).toBe(1);
      expect(run('SREM', 's', 'b')).toBe(1);
      expect(run('EXISTS', 's')).toBe(0);
      expect(run('SREM', 'gone', 'x')).toBe(0);
      expect(run('SCARD', 'missing')).toBe(0);
    });
  });

  describe('sorted sets', () => {
    beforeEach(() => {
      run('ZADD', 'z', 1, 'a', 2, 'b', 3, 'c');
    });

    it('ZADD / ZCARD / ZSCORE', () => {
      expect(run('ZCARD', 'z')).toBe(3);
      expect(run('ZSCORE', 'z', 'b')).toBe('2');
      expect(run('ZSCORE', 'z', 'missing')).toBeNull();
      expect(run('ZADD', 'z', 5, 'b')).toBe(0); // update existing
      expect(run('ZSCORE', 'z', 'b')).toBe('5');
    });

    it('ZRANGE with positive, negative indices and WITHSCORES', () => {
      expect(run('ZRANGE', 'z', 0, -1)).toEqual(['a', 'b', 'c']);
      expect(run('ZRANGE', 'z', 0, 0)).toEqual(['a']);
      expect(run('ZRANGE', 'z', -2, -1)).toEqual(['b', 'c']);
      expect(run('ZRANGE', 'z', 0, -1, 'WITHSCORES')).toEqual(['a', '1', 'b', '2', 'c', '3']);
    });

    it('ZRANGEBYSCORE with inclusive and exclusive bounds and -inf/+inf', () => {
      expect(run('ZRANGEBYSCORE', 'z', 2, 3)).toEqual(['b', 'c']);
      expect(run('ZRANGEBYSCORE', 'z', '(1', '+inf')).toEqual(['b', 'c']);
      expect(run('ZRANGEBYSCORE', 'z', '-inf', '(3')).toEqual(['a', 'b']);
    });

    it('ZREMRANGEBYSCORE and ZCOUNT', () => {
      expect(run('ZCOUNT', 'z', 1, 2)).toBe(2);
      expect(run('ZCOUNT', 'missing', 1, 2)).toBe(0);
      expect(run('ZREMRANGEBYSCORE', 'z', 1, 2)).toBe(2);
      expect(run('ZCARD', 'z')).toBe(1);
      expect(run('ZREMRANGEBYSCORE', 'gone', 1, 2)).toBe(0);
    });

    it('ZREM drops the key when empty', () => {
      expect(run('ZREM', 'z', 'a', 'b', 'c')).toBe(3);
      expect(run('EXISTS', 'z')).toBe(0);
      expect(run('ZREM', 'gone', 'x')).toBe(0);
    });
  });

  describe('streams', () => {
    it('XADD generates monotonic ids and XLEN counts entries', () => {
      const id1 = run('XADD', 's', '*', 'data', 'a') as string;
      const id2 = run('XADD', 's', '*', 'data', 'b') as string;
      expect(id1).toMatch(/^\d+-\d+$/);
      expect(run('XLEN', 's')).toBe(2);
      // id2 must sort after id1
      expect([id1, id2].slice().sort()).toEqual([id1, id2]);
    });

    it('XADD with an explicit id and rejects non-monotonic ids', () => {
      expect(run('XADD', 's', '5-0', 'k', 'v')).toBe('5-0');
      expect(run('XADD', 's', '5-1', 'k', 'v')).toBe('5-1');
      expect(() => run('XADD', 's', '3-0', 'k', 'v')).toThrow(MemoryDriverError);
    });

    it('XADD NOMKSTREAM returns null when the stream is missing', () => {
      expect(run('XADD', 'missing', 'NOMKSTREAM', '*', 'k', 'v')).toBeNull();
      expect(run('EXISTS', 'missing')).toBe(0);
    });

    it('XADD MAXLEN trims to the newest entries', () => {
      run('XADD', 's', '1-0', 'k', 'v');
      run('XADD', 's', '2-0', 'k', 'v');
      run('XADD', 's', 'MAXLEN', '2', '3-0', 'k', 'v'); // options precede the id
      expect(run('XLEN', 's')).toBe(2);
    });

    it('XADD MINID drops entries older than the given id', () => {
      run('XADD', 's', '1-0', 'k', 'v');
      run('XADD', 's', '2-0', 'k', 'v');
      run('XADD', 's', 'MINID', '2', '3-0', 'k', 'v'); // options precede the id
      const ids = (run('XRANGE', 's', '-', '+') as Array<[string, string[]]>).map(([id]) => id);
      expect(ids).not.toContain('1-0');
    });

    it('XRANGE / XREVRANGE with bounds and COUNT', () => {
      run('XADD', 's', '1-0', 'f', '1');
      run('XADD', 's', '2-0', 'f', '2');
      run('XADD', 's', '3-0', 'f', '3');
      expect(run('XRANGE', 's', '-', '+')).toEqual([
        ['1-0', ['f', '1']],
        ['2-0', ['f', '2']],
        ['3-0', ['f', '3']],
      ]);
      expect(run('XRANGE', 's', '2', '+')).toEqual([
        ['2-0', ['f', '2']],
        ['3-0', ['f', '3']],
      ]);
      expect(run('XRANGE', 's', '-', '+', 'COUNT', 1)).toEqual([['1-0', ['f', '1']]]);
      expect(run('XREVRANGE', 's', '+', '-', 'COUNT', 1)).toEqual([['3-0', ['f', '3']]]);
      expect(run('XRANGE', 'missing', '-', '+')).toEqual([]);
    });

    it('XDEL removes entries; XTRIM trims', () => {
      run('XADD', 's', '1-0', 'f', '1');
      run('XADD', 's', '2-0', 'f', '2');
      expect(run('XDEL', 's', '1-0', 'nope')).toBe(1);
      run('XADD', 's', '3-0', 'f', '3');
      expect(run('XTRIM', 's', 'MAXLEN', '~', '1')).toBe(1);
      expect(run('XLEN', 's')).toBe(1);
      expect(run('XDEL', 'missing', '1-0')).toBe(0);
    });

    it('XINFO STREAM reports length, last id, and first/last entries', () => {
      run('XADD', 's', '1-0', 'f', '1');
      run('XADD', 's', '2-0', 'f', '2');
      const info = run('XINFO', 'STREAM', 's') as unknown[];
      const map: Record<string, unknown> = {};
      for (let i = 0; i < info.length; i += 2) map[String(info[i])] = info[i + 1];
      expect(map['length']).toBe(2);
      expect(map['last-generated-id']).toBe('2-0');
      expect(map['first-entry']).toEqual(['1-0', ['f', '1']]);
      expect(() => run('XINFO', 'STREAM', 'missing')).toThrow(MemoryDriverError);
    });

    it('XGROUP CREATE/DESTROY/SETID/DELCONSUMER with MKSTREAM and BUSYGROUP', () => {
      expect(run('XGROUP', 'CREATE', 's', 'g', '$', 'MKSTREAM')).toBe('OK');
      expect(run('TYPE', 's')).toBe('stream');
      expect(() => run('XGROUP', 'CREATE', 's', 'g', '$')).toThrow(/BUSYGROUP/);
      expect(() => run('XGROUP', 'CREATE', 'nostream', 'g', '$')).toThrow(MemoryDriverError);
      expect(run('XGROUP', 'SETID', 's', 'g', '0')).toBe('OK');
      expect(run('XGROUP', 'DELCONSUMER', 's', 'g', 'c1')).toBe(0);
      expect(run('XGROUP', 'DESTROY', 's', 'g')).toBe(1);
      expect(run('XGROUP', 'DESTROY', 's', 'g')).toBe(0);
    });

    it('XREADGROUP delivers new messages, tracks PEL, and re-reads history', () => {
      run('XADD', 's', '1-0', 'f', '1');
      run('XADD', 's', '2-0', 'f', '2');
      run('XGROUP', 'CREATE', 's', 'g', '0');

      // '>' delivers all new entries and adds them to the PEL
      const fresh = run('XREADGROUP', 'GROUP', 'g', 'c1', 'COUNT', 10, 'STREAMS', 's', '>');
      expect(fresh).toEqual([
        [
          's',
          [
            ['1-0', ['f', '1']],
            ['2-0', ['f', '2']],
          ],
        ],
      ]);

      // a second '>' read finds nothing new -> null
      expect(run('XREADGROUP', 'GROUP', 'g', 'c1', 'STREAMS', 's', '>')).toBeNull();

      // history re-read (id '0') returns this consumer's still-pending entries
      const history = run('XREADGROUP', 'GROUP', 'g', 'c1', 'STREAMS', 's', '0') as Array<[string, unknown[]]>;
      expect(history[0]![1]).toHaveLength(2);
    });

    it('XREADGROUP NOACK does not populate the PEL', () => {
      run('XADD', 's', '1-0', 'f', '1');
      run('XGROUP', 'CREATE', 's', 'g', '0');
      run('XREADGROUP', 'GROUP', 'g', 'c1', 'NOACK', 'STREAMS', 's', '>');
      expect(run('XPENDING', 's', 'g')).toEqual([0, null, null, null]);
    });

    it('XACK acknowledges pending entries and is 0 for unknown group', () => {
      run('XADD', 's', '1-0', 'f', '1');
      run('XGROUP', 'CREATE', 's', 'g', '0');
      run('XREADGROUP', 'GROUP', 'g', 'c1', 'STREAMS', 's', '>');
      expect(run('XACK', 's', 'g', '1-0')).toBe(1);
      expect(run('XACK', 's', 'g', '1-0')).toBe(0);
      expect(run('XACK', 's', 'nogroup', '1-0')).toBe(0);
      expect(run('XACK', 'missing', 'g', '1-0')).toBe(0);
    });

    it('XPENDING summary and range', () => {
      run('XADD', 's', '1-0', 'f', '1');
      run('XADD', 's', '2-0', 'f', '2');
      run('XGROUP', 'CREATE', 's', 'g', '0');
      run('XREADGROUP', 'GROUP', 'g', 'c1', 'STREAMS', 's', '>');

      const summary = run('XPENDING', 's', 'g') as unknown[];
      expect(summary[0]).toBe(2);
      expect(summary[1]).toBe('1-0');
      expect(summary[2]).toBe('2-0');
      expect(summary[3]).toEqual([['c1', '2']]);

      const range = run('XPENDING', 's', 'g', '-', '+', 10) as Array<[string, string, number, number]>;
      expect(range).toHaveLength(2);
      expect(range[0]![0]).toBe('1-0');
      expect(range[0]![1]).toBe('c1');
      expect(range[0]![3]).toBe(1); // delivery count
    });

    it('XCLAIM reassigns idle pending entries to another consumer', () => {
      run('XADD', 's', '1-0', 'f', '1');
      run('XGROUP', 'CREATE', 's', 'g', '0');
      run('XREADGROUP', 'GROUP', 'g', 'c1', 'STREAMS', 's', '>');

      // minIdle 0 claims immediately; entry returned and reassigned to c2
      const claimed = run('XCLAIM', 's', 'g', 'c2', 0, '1-0');
      expect(claimed).toEqual([['1-0', ['f', '1']]]);

      const range = run('XPENDING', 's', 'g', '-', '+', 10) as Array<[string, string, number, number]>;
      expect(range[0]![1]).toBe('c2'); // now owned by c2
      expect(range[0]![3]).toBe(2); // delivery count incremented

      // high minIdle does not claim
      expect(run('XCLAIM', 's', 'g', 'c3', 999999, '1-0')).toEqual([]);
      expect(run('XCLAIM', 'missing', 'g', 'c', 0, '1-0')).toEqual([]);
    });

    it('XREAD returns entries after the given id', () => {
      run('XADD', 's', '1-0', 'f', '1');
      run('XADD', 's', '2-0', 'f', '2');
      expect(run('XREAD', 'STREAMS', 's', '1-0')).toEqual([['s', [['2-0', ['f', '2']]]]]);
      expect(run('XREAD', 'STREAMS', 's', '2-0')).toBeNull();
    });

    it('rejects unsupported stream subcommands', () => {
      expect(() => run('XINFO', 'GROUPS', 's')).toThrow(MemoryDriverError);
      expect(() => run('XGROUP', 'CREATECONSUMER', 's', 'g', 'c')).toThrow(MemoryDriverError);
      run('XADD', 's', '1-0', 'f', '1');
      expect(() => run('XTRIM', 's', 'MINID', '1')).toThrow(MemoryDriverError);
    });
  });

  describe('scripting', () => {
    const SCRIPT = "return redis.call('GET', KEYS[1])";

    it('SCRIPT LOAD computes a sha and EVALSHA runs it', () => {
      run('SET', 'k', 'v');
      const sha = run('SCRIPT', 'LOAD', SCRIPT) as string;
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(run('EVALSHA', sha, 1, 'k')).toBe('v');
    });

    it('SCRIPT with another subcommand returns OK', () => {
      expect(run('SCRIPT', 'FLUSH')).toBe('OK');
    });

    it('EVAL runs inline', () => {
      run('SET', 'k', 'v');
      expect(run('EVAL', SCRIPT, 1, 'k')).toBe('v');
    });

    it('EVALSHA throws NOSCRIPT for an unknown sha', () => {
      expect(() => run('EVALSHA', 'deadbeef', 0)).toThrow(/NOSCRIPT/);
    });
  });

  describe('errors', () => {
    it('throws on an unimplemented command', () => {
      expect(() => run('GEOADD', 'k')).toThrow(MemoryDriverError);
    });

    it('throws on a non-integer numeric argument', () => {
      expect(() => run('INCRBY', 'k', 'notanumber')).toThrow(MemoryDriverError);
    });
  });
});
