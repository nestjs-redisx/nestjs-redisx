# Integration Tests - Cache + Core with Real Redis

This directory contains integration tests that verify the Cache module works correctly with the Core module using a real Redis instance.

## Overview

These tests check:
- ✅ Cache + Core module integration
- ✅ Real Redis operations (set, get, del)
- ✅ L1 (in-memory) + L2 (Redis) dual-layer caching
- ✅ Tag-based invalidation with Redis sets
- ✅ Stampede protection with real concurrent operations
- ✅ TTL and expiration with real timers
- ✅ Complex data types serialization/deserialization
- ✅ Real-world usage scenarios

## Prerequisites

You need Docker and Docker Compose installed:

```bash
# Check Docker
docker --version

# Check Docker Compose
docker-compose --version
```

## Quick Start

### Option 1: Automated (Recommended)

Run tests with automatic Docker setup and teardown:

```bash
npm run test:docker
```

This command will:
1. Start Redis container via docker-compose
2. Wait for Redis to be ready
3. Run integration tests
4. Stop and remove Redis container

### Option 2: Manual

Start Redis manually and run tests:

```bash
# Terminal 1: Start Redis
npm run docker:up

# Check Redis is running
docker ps | grep nestjs-redisx-cache-test-redis

# Terminal 2: Run tests
npm run test:integration

# When done, stop Redis
npm run docker:down
```

### Option 3: Watch Mode

For development, keep Redis running and use watch mode:

```bash
# Terminal 1: Start Redis
npm run docker:up

# Terminal 2: Run tests in watch mode
npm run test:integration:watch

# When done
npm run docker:down
```

## Available Scripts

```bash
# Start Redis container
npm run docker:up

# Stop Redis container
npm run docker:down

# View Redis logs
npm run docker:logs

# Run integration tests (requires Redis running)
npm run test:integration

# Run integration tests in watch mode
npm run test:integration:watch

# Run tests with auto Docker setup/teardown
npm run test:docker

# Run all tests (unit + integration)
npm run test:all
```

## Redis Configuration

The tests use a Redis container configured via `docker-compose.yml`:

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    # Optimized for testing
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
```

### Connection Settings

- **Host:** localhost
- **Port:** 6379
- **Database:** 15 (dedicated for tests)
- **Max Memory:** 256MB
- **Eviction Policy:** allkeys-lru

### Environment Variables

Override defaults with environment variables:

```bash
# Custom Redis host
REDIS_HOST=localhost npm run test:integration

# Custom Redis port
REDIS_PORT=6380 npm run test:integration

# Custom database
REDIS_DB=10 npm run test:integration
```

## Test Structure

### cache-with-redis.integration.spec.ts

Comprehensive integration tests covering:

**Basic Operations** (5 tests)
- Set and get values
- Verify data in Redis
- Delete operations
- Key existence checks
- TTL management

**L1 + L2 Caching** (3 tests)
- L1 fast access
- L2 backfill on L1 miss
- Data persistence

**Batch Operations** (2 tests)
- Multi-get (mget)
- Multi-set (mset)

**getOrSet Pattern** (2 tests)
- Loader execution on miss
- Error handling

**Function Wrapping** (2 tests)
- Wrap with caching
- Dynamic tags

**Tag-Based Invalidation** (3 tests)
- Single tag invalidation
- Multiple tag invalidation
- Tag storage verification

**Stampede Protection** (2 tests)
- Prevent concurrent loaders
- Handle different keys

**Complex Data Types** (3 tests)
- Nested objects
- Arrays
- Dates as ISO strings

**TTL and Expiration** (3 tests)
- Entry expiration
- Default TTL
- TTL updates

**Error Handling** (3 tests)
- Connection errors
- Serialization errors
- Large keys

**Cache Statistics** (1 test)
- Hit/miss tracking

**Real-World Scenarios** (2 tests)
- User profile caching
- Product pagination

**Concurrent Operations** (2 tests)
- Many concurrent ops
- Concurrent invalidations

**Total: 33 tests**

## What These Tests Verify

### Integration Points

1. **NestJS Module System**
   - RedisModule provides IRedisDriver
   - CacheModule receives driver via DI
   - Services are properly wired

2. **Redis Operations**
   - Data actually stored in Redis
   - Tag indexes created as Redis sets
   - TTL set correctly in Redis
   - Keys use configured prefix

3. **L1 + L2 Architecture**
   - L1 provides fast in-memory access
   - L2 persists to Redis
   - Backfill from L2 to L1 works
   - Invalidation clears both layers

4. **Concurrency**
   - Stampede protection prevents duplicate loads
   - Concurrent operations don't conflict
   - Tag invalidation handles race conditions

## Debugging Tests

### View Redis Data

Connect to Redis while tests are running:

```bash
# Start Redis
npm run docker:up

# Connect to Redis CLI
docker exec -it nestjs-redisx-cache-test-redis redis-cli

# Select test database
> SELECT 15

# View all keys
> KEYS test:cache:*

# Get specific key
> GET test:cache:integration:user:1

# View tag index
> SMEMBERS test:cache:__tag:users

# View TTL
> TTL test:cache:integration:user:1
```

### View Logs

```bash
# View Redis logs in real-time
npm run docker:logs

# Or with Docker
docker logs -f nestjs-redisx-cache-test-redis
```

### Run Single Test

```bash
# Run specific test by name
npm run test:integration -- -t "should set and get value"

# Run specific describe block
npm run test:integration -- -t "Tag-Based Invalidation"
```

### Debug Mode

```bash
# Run with debug output
DEBUG=* npm run test:integration

# Or with Vitest UI
npx vitest --ui test/integration/cache-with-redis.integration.spec.ts
```

## Troubleshooting

### Redis not starting

```bash
# Check if port 6379 is in use
lsof -i :6379

# Stop conflicting Redis
brew services stop redis

# Or use different port
# Edit docker-compose.yml: "6380:6379"
```

### Tests timing out

Increase test timeout in the test file:

```typescript
it('slow test', async () => {
  // test code
}, 10000); // 10 second timeout
```

### Connection refused

```bash
# Verify Redis is running
docker ps | grep redis

# Check Redis is healthy
docker exec nestjs-redisx-cache-test-redis redis-cli ping
# Should return: PONG

# Restart Redis
npm run docker:down && npm run docker:up
```

### Stale data between tests

Each test should clean up, but you can flush manually:

```bash
docker exec nestjs-redisx-cache-test-redis redis-cli -n 15 FLUSHDB
```

## CI/CD Integration

### GitHub Actions

```yaml
name: Integration Tests

on: [push, pull_request]

jobs:
  integration:
    runs-on: ubuntu-latest

    services:
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Run integration tests
        run: npm run test:integration
        env:
          REDIS_HOST: localhost
          REDIS_PORT: 6379
```

### GitLab CI

```yaml
integration-tests:
  image: node:20

  services:
    - redis:7-alpine

  variables:
    REDIS_HOST: redis
    REDIS_PORT: 6379

  script:
    - npm ci
    - npm run test:integration
```

## Performance Notes

- **L1 Cache**: < 10ms response time
- **L2 Cache**: 10-50ms response time
- **Repository call**: 100+ ms (simulated)
- **Stampede protection**: Prevents N duplicate calls → 1 call

## Best Practices

1. **Isolation**: Each test should be independent
2. **Cleanup**: Always clear cache in `beforeEach`
3. **Timeouts**: Use appropriate timeouts for async operations
4. **Verification**: Verify data in Redis, not just cache API
5. **Concurrency**: Test real concurrent scenarios
6. **Tags**: Verify tag indexes are created correctly

## Additional Resources

- [Main Test Documentation](../README.md)
- [Cache Plugin Documentation](../../README.md)
- [Redis Docker Image](https://hub.docker.com/_/redis)
- [Docker Compose Reference](https://docs.docker.com/compose/)
