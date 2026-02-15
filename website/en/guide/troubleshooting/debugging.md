---
title: Debugging
description: Tools and techniques for debugging RedisX issues
---

# Debugging

Tools and techniques for debugging NestJS RedisX issues.

## Redis CLI Commands

### Inspect Keys

```bash
# List all keys (use SCAN in production)
redis-cli KEYS "*"

# Find keys by pattern
redis-cli KEYS "cache:user:*"

# Count keys
redis-cli DBSIZE

# Get key type
redis-cli TYPE "cache:user:123"

# Get TTL
redis-cli TTL "cache:user:123"
```

### Inspect Values

```bash
# Get string value
redis-cli GET "cache:user:123"

# Get hash
redis-cli HGETALL "hash:key"

# Get list
redis-cli LRANGE "list:key" 0 -1

# Get set members
redis-cli SMEMBERS "set:key"

# Get stream messages
redis-cli XRANGE "stream:orders" - + COUNT 10
```

### Real-Time Monitoring

```bash
# Monitor all commands (⚠️ impacts performance)
redis-cli MONITOR

# Monitor specific patterns
redis-cli MONITOR | grep "cache:"

# Check slow log
redis-cli SLOWLOG GET 10
redis-cli SLOWLOG RESET
```

### Memory Analysis

```bash
# Memory stats
redis-cli INFO memory

# Memory usage for key
redis-cli MEMORY USAGE "cache:user:123"

# Find big keys
redis-cli --bigkeys

# Memory doctor
redis-cli MEMORY DOCTOR
```

## Debug Logging

### Enable Debug Logs

```typescript
// Enable debug mode
RedisModule.forRoot({
  clients: { host: 'localhost' },
  debug: true,  // Enable verbose logging
})
```

### Custom Logging

```typescript
@Injectable()
export class DebugCacheService implements OnModuleInit {
  private readonly logger = new Logger('Cache');

  constructor(@Inject(CACHE_SERVICE) private cache: ICacheService) {}

  async get<T>(key: string): Promise<T | null> {
    const start = Date.now();
    const result = await this.cache.get<T>(key);
    const duration = Date.now() - start;

    this.logger.debug(
      `GET ${key} - ${result ? 'HIT' : 'MISS'} - ${duration}ms`,
    );

    return result;
  }
}
```

## Tracing

### Enable Tracing for Debugging

```typescript
new TracingPlugin({
  serviceName: 'my-service',
  sampling: { strategy: 'always' },  // 100% sampling for debugging
})
```

### Find Slow Operations

In Jaeger:
1. Search for service
2. Filter by min duration (e.g., >100ms)
3. Examine span details

## Common Debug Scenarios

### "Is my data being cached?"

```bash
# Before request
redis-cli KEYS "cache:user:123"  # Should be empty

# Make request
curl http://localhost:3000/users/123

# After request
redis-cli GET "cache:user:123"  # Should have data
redis-cli TTL "cache:user:123"  # Should show remaining TTL
```

### "Is invalidation working?"

```bash
# Check cache exists
redis-cli EXISTS "cache:user:123"

# Trigger invalidation (e.g., update user)
curl -X PUT http://localhost:3000/users/123 -d '{"name":"New"}'

# Check cache cleared
redis-cli EXISTS "cache:user:123"  # Should be 0
```

### "Who holds this lock?"

```bash
# Check lock
redis-cli GET "lock:payment:order-123"
# Returns: owner token (UUID)

# Check TTL
redis-cli TTL "lock:payment:order-123"
# Returns: seconds remaining
```

### "Why is the stream backing up?"

```bash
# Check stream length
redis-cli XLEN jobs

# Check consumer group info
redis-cli XINFO GROUPS jobs

# Check pending messages
redis-cli XPENDING jobs workers

# Check specific consumer
redis-cli XPENDING jobs workers - + 10 consumer-1
```

## Test Utilities

### Redis Test Helper

```typescript
// test/redis-helper.ts
export class RedisDebugHelper {
  constructor(private redis: Redis) {}

  async dump(pattern: string): Promise<void> {
    const keys = await this.scanKeys(pattern);
    for (const key of keys) {
      const type = await this.redis.type(key);
      const ttl = await this.redis.ttl(key);
      let value: any;

      switch (type) {
        case 'string':
          value = await this.redis.get(key);
          break;
        case 'hash':
          value = await this.redis.hgetall(key);
          break;
        case 'list':
          value = await this.redis.lrange(key, 0, -1);
          break;
        case 'set':
          value = await this.redis.smembers(key);
          break;
      }

      console.log({
        key,
        type,
        ttl,
        value: type === 'string' ? JSON.parse(value) : value,
      });
    }
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [newCursor, batch] = await this.redis.scan(cursor, 'MATCH', pattern);
      cursor = newCursor;
      keys.push(...batch);
    } while (cursor !== '0');
    return keys;
  }
}
```

## Debugging Checklist

::: tip Quick Debug Steps
Run these commands to diagnose common issues:
:::

| Check | Command |
|-------|--------|
| Redis connectivity | `redis-cli PING` |
| Key exists | `redis-cli EXISTS key` |
| Key TTL | `redis-cli TTL key` |
| Key value | `redis-cli GET key` |
| Slow log | `redis-cli SLOWLOG GET 10` |
| Memory | `redis-cli INFO memory` |
| Application logs | Check your logging system |
| Jaeger traces | Open Jaeger UI |
| Prometheus metrics | Query Grafana dashboards |

## Next Steps

- [Cache Issues](./cache-issues) — Cache-specific problems
- [Lock Issues](./lock-issues) — Lock-specific problems
- [Performance Issues](./performance-issues) — Latency problems
