# Integration Tests

Integration tests for the rate-limit module with real Redis connection.

## Prerequisites

Before running integration tests, you need a running Redis instance.

### Option 1: Using Docker Compose (Recommended)

From the **project root** directory:

```bash
# Start Redis
docker-compose up -d redis

# Check Redis status
docker-compose ps redis

# View Redis logs
docker-compose logs -f redis
```

### Option 2: Using Package Scripts

From the **rate-limit package** directory:

```bash
# Start Redis (runs docker-compose from project root)
npm run docker:up

# View logs
npm run docker:logs

# Stop Redis
npm run docker:down
```

### Option 3: Local Redis Installation

If you have Redis installed locally, make sure it's running on `localhost:6379`.

## Running Integration Tests

### Run all integration tests

```bash
npm run test:integration
```

### Run integration tests in watch mode

```bash
npm run test:integration:watch
```

### Run integration tests with Docker (auto-start/stop)

```bash
npm run test:docker
```

This command will:
1. Start Redis via docker-compose
2. Wait 3 seconds for Redis to be ready
3. Run integration tests
4. Stop Redis
5. Exit with test result code

### Run all tests (unit + integration)

```bash
npm run test:all
```

## Test Coverage

Integration tests cover:

### Fixed Window Algorithm
- ✅ Allow requests within limit
- ✅ Deny requests exceeding limit
- ✅ Reset after window expires

### Sliding Window Algorithm
- ✅ Allow requests within limit
- ✅ Deny requests exceeding limit
- ✅ Smooth limiting across time windows

### Token Bucket Algorithm
- ✅ Allow burst up to capacity
- ✅ Deny when bucket empty
- ✅ Refill tokens over time

### Concurrent Requests
- ✅ Correctly count concurrent requests
- ✅ Handle race conditions with Lua scripts

### Additional Functionality
- ✅ Reset rate limit state
- ✅ Peek without consuming
- ✅ Get state with Date object
- ✅ Maintain separate state for different algorithms

## Test Configuration

Integration tests use:
- **Redis DB**: 15 (separate from production)
- **Key Prefix**: `rl:test:` (to avoid conflicts)
- **Host**: localhost
- **Port**: 6379

## Troubleshooting

### Redis not connecting

```bash
# Check if Redis is running
docker ps | grep redis

# Check Redis health
docker-compose exec redis redis-cli ping
# Should return: PONG
```

### Port 6379 already in use

```bash
# Find process using port 6379
lsof -i :6379

# Kill the process
kill -9 <PID>

# Or use different Redis instance on different port
# Update test configuration in rate-limit.integration.spec.ts
```

### Tests timing out

Some tests use `setTimeout` to test time-based behavior. If your system is slow, increase timeout values in `vitest.config.ts`:

```typescript
export default defineConfig({
  test: {
    testTimeout: 30000, // Increase from default
  },
});
```

## CI/CD Integration

In CI/CD pipelines, use the `test:docker` command which handles Redis lifecycle:

```yaml
# GitHub Actions example
- name: Run integration tests
  run: npm run test:docker
```

Or use Redis service containers:

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - 6379:6379
    options: >-
      --health-cmd "redis-cli ping"
      --health-interval 5s
      --health-timeout 3s
      --health-retries 5

steps:
  - name: Run tests
    run: npm run test:integration
```

## Writing New Integration Tests

Follow this pattern:

```typescript
it('should test rate limiting behavior', async () => {
  // Given - Use unique key to avoid conflicts
  const key = `test-${Date.now()}`;

  // When - Perform operations
  const result = await service.check(key, {
    algorithm: 'sliding-window',
    points: 10,
    duration: 60,
  });

  // Then - Assert results
  expect(result.allowed).toBe(true);
  expect(result.remaining).toBe(9);
});
```

**Important:**
- Always use unique keys (e.g., `${Date.now()}`)
- Use `rl:test:` prefix (configured in module)
- Clean up is automatic (keys expire)
- Test DB 15 is separate from production

## Performance Benchmarks

Typical test execution times:
- **Setup**: ~1s (NestJS module initialization)
- **Per test**: 50-300ms (most tests)
- **Time-based tests**: 2-4s (tests with `setTimeout`)
- **Total suite**: ~5-6s (16 tests)

Concurrent request tests verify Lua script atomicity with 50-100 parallel requests.
