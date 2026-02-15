---
title: Troubleshooting
description: Common issues and solutions
---

# Troubleshooting

Common issues and how to fix them.

## Rate Limit Not Working

### Problem: Requests not being rate limited

**Symptoms:**
- No 429 responses
- Headers not appearing
- Unlimited requests allowed

**Solutions:**

1. **Check plugin registration:**
```typescript
// Correct
RedisModule.forRoot({
  clients: { host: 'localhost', port: 6379 },
  plugins: [new RateLimitPlugin()],
})

// Wrong - plugin not registered
RedisModule.forRoot({
  clients: { host: 'localhost', port: 6379 },
})
```

2. **Check decorator application:**
```typescript
// Correct
@Get('data')
@RateLimit({ points: 10, duration: 60 })
getData() {}

// Wrong - no decorator
@Get('data')
getData() {}
```

3. **Check guard is applied:**
```typescript
// If using decorator, guard is automatic
// If manual, ensure guard is used:
@UseGuards(RateLimitGuard)
```

## Headers Not Appearing

### Problem: X-RateLimit-* headers missing

**Symptoms:**
- No rate limit headers in response
- Client can't see remaining requests

**Solutions:**

1. **Enable headers in config:**
```typescript
new RateLimitPlugin({
  includeHeaders: true,  // Must be true
})
```

2. **Check CORS configuration:**
```typescript
app.enableCors({
  exposedHeaders: [
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'Retry-After',
  ],
});
```

3. **Check module-level setting:**
```typescript
new RateLimitPlugin({
  includeHeaders: true,  // Must be true (default)
})
```

## Redis Connection Issues

### Problem: Rate limiting fails with Redis errors

**Symptoms:**
- 503 Service Unavailable
- Errors in logs: "Redis connection refused"
- All requests rejected (fail-closed)

**Solutions:**

1. **Check Redis is running:**
```bash
redis-cli ping
# Should return: PONG
```

2. **Check connection config:**
```typescript
RedisModule.forRoot({
  clients: {
    host: 'localhost',  // Correct host?
    port: 6379,         // Correct port?
  },
  plugins: [new RateLimitPlugin()],
})
```

3. **Use fail-open for availability:**
```typescript
new RateLimitPlugin({
  errorPolicy: 'fail-open',  // Allow requests on Redis error
})
```

## Key Extraction Issues

### Problem: Wrong clients being rate limited together

**Symptoms:**
- All users share the same limit
- Anonymous users hit authenticated limits
- Rate limits not working per-user

**Solutions:**

1. **Check key extraction:**
```typescript
// Wrong - all users share same key
@RateLimit({ key: 'global' })

// Correct - per-user key
@RateLimit({ key: 'user' })
```

2. **Ensure request.user is set:**
```typescript
// Auth guard must run BEFORE rate limit guard
@UseGuards(AuthGuard, RateLimitGuard)
@RateLimit({ key: 'user' })
```

3. **Check IP extraction behind proxy:**
```typescript
// Trust proxy headers
app.set('trust proxy', true);

// Or custom extractor
new RateLimitPlugin({
  defaultKeyExtractor: (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    return req.headers['x-real-ip'] || req.ip;
  },
})
```

## Algorithm Not Working as Expected

### Problem: Rate limiting behavior unexpected

**Symptoms:**
- Bursts allowed at window boundaries (Fixed Window)
- Higher memory usage than expected (Sliding Window)
- Unpredictable limits (Token Bucket)

**Solutions:**

1. **Fixed Window burst issue:**
```typescript
// Problem: 2x limit at window boundary
@RateLimit({ algorithm: 'fixed-window' })

// Solution: Use sliding window
@RateLimit({ algorithm: 'sliding-window' })
```

2. **Token Bucket configuration:**
```typescript
// Wrong - too fast refill
@RateLimit({
  algorithm: 'token-bucket',
  points: 100,
  refillRate: 1000,  // 1000 tokens/sec = no limit!
})

// Correct - reasonable refill
@RateLimit({
  algorithm: 'token-bucket',
  points: 100,
  refillRate: 10,  // 10 tokens/sec
})
```

## Performance Issues

### Problem: Rate limiting slow

**Symptoms:**
- High latency on requests
- Slow response times
- Redis CPU high

**Solutions:**

1. **Check Redis latency:**
```bash
redis-cli --latency
# Should be < 1ms locally
```

2. **Use simpler algorithm:**
```typescript
// Sliding Window uses more memory and operations
@RateLimit({ algorithm: 'sliding-window' })

// Fixed Window is faster
@RateLimit({ algorithm: 'fixed-window' })
```

3. **Optimize key structure:**
```typescript
// Long keys waste memory
key: `organization:${org}:user:${user}:endpoint:${endpoint}`

// Shorter keys
key: `${org}:${user}:${endpoint}`
```

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `RateLimitExceededError` | Limit exceeded | Wait for reset or increase limit |
| `RateLimitScriptError` | Lua script execution failed | Check Redis connection and version |

## Debug Mode

Use NestJS logger to debug rate limiting. Set the log level to `debug` and check the `RateLimitGuard` output:

```typescript
const app = await NestFactory.create(AppModule, {
  logger: ['debug', 'log', 'warn', 'error'],
});
```

## Inspect Redis Keys

```bash
# List all rate limit keys
redis-cli --scan --pattern 'rl:*'

# Get specific key (includes algorithm in key)
redis-cli GET rl:sliding-window:192.168.1.1

# Check TTL
redis-cli TTL rl:sliding-window:192.168.1.1

# Delete specific key
redis-cli DEL rl:sliding-window:192.168.1.1

# Delete all rate limit keys
redis-cli --scan --pattern 'rl:*' | xargs redis-cli DEL
```

## Test Rate Limiting

```bash
# Hit endpoint multiple times
for i in {1..15}; do
  curl -i http://localhost:3000/api/data
  echo "Request $i"
done

# Check headers
curl -i http://localhost:3000/api/data | grep -i ratelimit
```

## Debug Checklist

- Redis is running and accessible
- Plugin registered in module
- Decorator applied to endpoint
- Guard is active (auto with decorator)
- Key extraction working correctly
- Headers enabled in config
- CORS configured (if cross-origin)
- Redis keys exist (check with redis-cli)
- TTL set on keys
- Logs show rate limit checks

## Common Misconfigurations

```typescript
// Points too high - no effective limit
@RateLimit({ points: 1000000, duration: 1 })

// Duration too long - not useful
@RateLimit({ points: 10, duration: 86400 })

// Wrong key type
@RateLimit({ key: 'user' })  // But no authentication!

// Multiple same decorators
@RateLimit({ points: 100 })
@RateLimit({ points: 100 })  // Duplicate, confusing

// Correct configuration
@RateLimit({
  key: 'user',
  algorithm: 'sliding-window',
  points: 100,
  duration: 60,
})
```

## Getting Help

If you're still stuck:

1. Check Redis connection: `redis-cli ping`
2. Enable debug logging
3. Inspect Redis keys: `redis-cli --scan --pattern 'rl:*'`
4. Check application logs for errors
5. Verify request headers and user context
6. Test with simple configuration first
7. Review [Configuration](./configuration) and [Key Extraction](./key-extraction) docs

## Next Steps

- [Monitoring](./monitoring) — Track rate limits
- [Overview](./index) — Back to overview
