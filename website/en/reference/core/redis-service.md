---
title: RedisService
description: High-level Redis operations API
---

# RedisService

Convenient wrapper for Redis operations with automatic connection management.

## Injection

```typescript
import { Injectable } from '@nestjs/common';
import { RedisService } from '@nestjs-redisx/core';

@Injectable()
export class UserService {
  constructor(private readonly redis: RedisService) {}
}
```

## Connection Methods

### isConnected

Check if default client is connected.

```typescript
const connected = await this.redis.isConnected();
```

### ping

Ping Redis server.

```typescript
const response = await this.redis.ping();
// Returns: 'PONG'

const custom = await this.redis.ping('hello');
// Returns: 'hello'
```

### select

Select database.

```typescript
await this.redis.select(1);
```

### getClient

Get named client for direct access.

```typescript
const cache = await this.redis.getClient('cache');
await cache.set('key', 'value');

// Default client
const defaultClient = await this.redis.getClient();
```

## String Commands

### get / set

```typescript
// Set value
await this.redis.set('key', 'value');

// Set with TTL (seconds)
await this.redis.set('key', 'value', { ex: 3600 });

// Set with TTL (milliseconds)
await this.redis.set('key', 'value', { px: 3600000 });

// Set only if not exists
await this.redis.set('key', 'value', { nx: true });

// Set only if exists
await this.redis.set('key', 'value', { xx: true });

// Get value
const value = await this.redis.get('key');
```

### mget / mset

```typescript
// Set multiple
await this.redis.mset({
  'user:1:name': 'Alice',
  'user:1:email': 'alice@example.com',
});

// Get multiple
const values = await this.redis.mget('user:1:name', 'user:1:email');
// Returns: ['Alice', 'alice@example.com']
```

### setex / setnx

```typescript
// Set with expiration
await this.redis.setex('session', 3600, 'data');

// Set only if not exists
const wasSet = await this.redis.setnx('lock', 'token');
// Returns: 1 if set, 0 if exists
```

### getdel / getex

```typescript
// Get and delete atomically
const deleted = await this.redis.getdel('temp-key');

// Get and set expiration
const refreshed = await this.redis.getex('key', { ex: 3600 });
```

### incr / decr

```typescript
// Increment
const val1 = await this.redis.incr('counter');

// Increment by amount
const val2 = await this.redis.incrby('counter', 5);

// Decrement
const val3 = await this.redis.decr('counter');

// Decrement by amount
const val4 = await this.redis.decrby('counter', 5);
```

### append

```typescript
const newLength = await this.redis.append('log', ' new entry');
```

## Key Commands

### del / exists

```typescript
// Delete keys
const deleted = await this.redis.del('key1', 'key2');

// Check existence
const exists = await this.redis.exists('key1', 'key2');
// Returns: number of existing keys
```

### expire / ttl

```typescript
// Set expiration (seconds)
await this.redis.expire('key', 3600);

// Set expiration (milliseconds)
await this.redis.pexpire('key', 3600000);

// Set expiration at timestamp
await this.redis.expireat('key', Math.floor(Date.now() / 1000) + 3600);

// Get TTL (seconds)
const ttl = await this.redis.ttl('key');

// Get TTL (milliseconds)
const pttl = await this.redis.pttl('key');

// Remove expiration
await this.redis.persist('key');
```

### rename / type

```typescript
// Rename key
await this.redis.rename('old-key', 'new-key');

// Rename only if new key doesn't exist
const renamed = await this.redis.renamenx('old-key', 'new-key');

// Get type
const type = await this.redis.type('key');
// Returns: 'string', 'list', 'set', 'zset', 'hash', 'stream', 'none'
```

### scan

```typescript
// Scan keys with pattern
let cursor = 0;
const keys: string[] = [];

do {
  const [newCursor, batch] = await this.redis.scan(cursor, {
    match: 'user:*',
    count: 100,
  });
  cursor = parseInt(newCursor);
  keys.push(...batch);
} while (cursor !== 0);
```

## Hash Commands

### hget / hset

```typescript
// Set field
await this.redis.hset('user:1', 'name', 'Alice');

// Get field
const name = await this.redis.hget('user:1', 'name');
```

### hmset / hmget / hgetall

```typescript
// Set multiple fields
await this.redis.hmset('user:1', {
  name: 'Alice',
  email: 'alice@example.com',
  age: '30',
});

// Get multiple fields
const values = await this.redis.hmget('user:1', 'name', 'email');

// Get all fields
const user = await this.redis.hgetall('user:1');
// Returns: { name: 'Alice', email: 'alice@example.com', age: '30' }
```

### hdel / hexists

```typescript
// Delete fields
const deleted = await this.redis.hdel('user:1', 'temp', 'cache');

// Check field exists
const exists = await this.redis.hexists('user:1', 'name');
```

### hkeys / hvals / hlen

```typescript
// Get all field names
const fields = await this.redis.hkeys('user:1');

// Get all values
const values = await this.redis.hvals('user:1');

// Get field count
const count = await this.redis.hlen('user:1');
```

### hincrby

```typescript
const newValue = await this.redis.hincrby('user:1', 'visits', 1);
```

### hscan

```typescript
let cursor = 0;
const fields: string[] = [];

do {
  const [newCursor, batch] = await this.redis.hscan('user:1', cursor, {
    match: 'pref:*',
    count: 100,
  });
  cursor = parseInt(newCursor);
  fields.push(...batch);
} while (cursor !== 0);
```

## List Commands

### lpush / rpush / lpop / rpop

```typescript
// Push to left
await this.redis.lpush('queue', 'item1', 'item2');

// Push to right
await this.redis.rpush('queue', 'item3', 'item4');

// Pop from left
const left = await this.redis.lpop('queue');

// Pop from right
const right = await this.redis.rpop('queue');
```

### llen / lrange

```typescript
// Get length
const length = await this.redis.llen('queue');

// Get range
const items = await this.redis.lrange('queue', 0, -1); // All items
const first10 = await this.redis.lrange('queue', 0, 9);
```

### ltrim / lindex / lset

```typescript
// Trim to range
await this.redis.ltrim('queue', 0, 99); // Keep first 100

// Get by index
const item = await this.redis.lindex('queue', 0);

// Set by index
await this.redis.lset('queue', 0, 'new-value');
```

## Set Commands

### sadd / srem / smembers

```typescript
// Add members
await this.redis.sadd('tags', 'redis', 'cache', 'database');

// Remove members
await this.redis.srem('tags', 'cache');

// Get all members
const tags = await this.redis.smembers('tags');
```

### sismember / scard

```typescript
// Check membership
const isMember = await this.redis.sismember('tags', 'redis');

// Get count
const count = await this.redis.scard('tags');
```

### sscan

```typescript
let cursor = 0;
const members: string[] = [];

do {
  const [newCursor, batch] = await this.redis.sscan('tags', cursor, {
    match: 'redis:*',
    count: 100,
  });
  cursor = parseInt(newCursor);
  members.push(...batch);
} while (cursor !== 0);
```

### srandmember / spop

```typescript
// Get random member
const random = await this.redis.srandmember('tags');

// Get multiple random
const randoms = await this.redis.srandmember('tags', 3);

// Pop random member
const popped = await this.redis.spop('tags');

// Pop multiple random members
const poppedMany = await this.redis.spop('tags', 3);
```

## Sorted Set Commands

### zadd / zrem

```typescript
// Add with scores
await this.redis.zadd('leaderboard', 100, 'alice', 95, 'bob', 90, 'charlie');

// Remove members
await this.redis.zrem('leaderboard', 'charlie');
```

### zrange / zrangebyscore

```typescript
// Get by rank
const top10 = await this.redis.zrange('leaderboard', 0, 9);

// Get by rank with scores
const top10WithScores = await this.redis.zrange('leaderboard', 0, 9, true);

// Get by score range
const highScorers = await this.redis.zrangebyscore('leaderboard', 90, 100);

// Get by score range with scores
const withScores = await this.redis.zrangebyscore('leaderboard', 90, 100, true);
```

### zscore / zrank / zcard

```typescript
// Get score
const score = await this.redis.zscore('leaderboard', 'alice');

// Get rank
const rank = await this.redis.zrank('leaderboard', 'alice');

// Get count
const count = await this.redis.zcard('leaderboard');
```

### zincrby

```typescript
const newScore = await this.redis.zincrby('leaderboard', 5, 'alice');
```

### zscan

```typescript
let cursor = 0;
const entries: string[] = [];

do {
  const [newCursor, batch] = await this.redis.zscan('leaderboard', cursor, {
    match: '*',
    count: 100,
  });
  cursor = parseInt(newCursor);
  entries.push(...batch); // [member1, score1, member2, score2, ...]
} while (cursor !== 0);
```

## Pub/Sub Commands

### publish

```typescript
const subscribers = await this.redis.publish('events', JSON.stringify({
  type: 'user.created',
  data: { id: '123' },
}));
```

### subscribe / unsubscribe

```typescript
// Subscribe to channels
await this.redis.subscribe('events', 'notifications');

// Unsubscribe
await this.redis.unsubscribe('events');
```

### psubscribe / punsubscribe

```typescript
// Subscribe to patterns
await this.redis.psubscribe('user.*', 'order.*');

// Unsubscribe from patterns
await this.redis.punsubscribe('user.*');
```

## Transaction Commands

### pipeline

Batch commands without transaction guarantees.

```typescript
const pipeline = await this.redis.pipeline();

pipeline
  .set('key1', 'value1')
  .set('key2', 'value2')
  .incr('counter')
  .get('key1');

const results = await pipeline.exec();
// Returns: [[null, 'OK'], [null, 'OK'], [null, 1], [null, 'value1']]
```

### multi

Atomic transaction with MULTI/EXEC.

```typescript
const multi = await this.redis.multi();

multi
  .set('balance:alice', '100')
  .set('balance:bob', '100')
  .decrby('balance:alice', 50)
  .incrby('balance:bob', 50);

const results = await multi.exec();
```

## Lua Scripts

### eval

```typescript
const result = await this.redis.eval(
  `
  local current = redis.call('GET', KEYS[1])
  if current then
    return redis.call('INCR', KEYS[1])
  else
    redis.call('SET', KEYS[1], ARGV[1])
    return tonumber(ARGV[1])
  end
  `,
  ['counter'],
  [1]
);
```

### evalsha / scriptLoad

```typescript
// Load script
const sha = await this.redis.scriptLoad(`
  return redis.call('GET', KEYS[1])
`);

// Execute by SHA
const result = await this.redis.evalsha(sha, ['key'], []);

// Check if scripts exist
const exists = await this.redis.scriptExists(sha);

// Flush all cached scripts
await this.redis.scriptFlush();
```

## Server Commands

### info / dbsize

```typescript
// Get server info
const info = await this.redis.info();
const memoryInfo = await this.redis.info('memory');

// Get database size
const keyCount = await this.redis.dbsize();
```

### flushdb / flushall

```typescript
// Clear current database
await this.redis.flushdb();

// Clear all databases
await this.redis.flushall();
```

## Next Steps

- [Multiple Clients](./multiple-clients) — Named client management
- [Connection Types](./connection-types) — Single, Cluster, Sentinel
- [Decorators](./decorators) — @InjectRedis usage
