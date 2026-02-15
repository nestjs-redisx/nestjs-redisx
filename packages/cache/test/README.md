# Cache Package Tests

This directory contains comprehensive tests for the cache package.

## Test Structure

```
test/
├── unit/                           # Unit tests (isolated, mocked)
│   ├── cache.service.spec.ts      # CacheService API tests
│   ├── key-builder.spec.ts        # KeyBuilder utility tests
│   └── decorators/
│       └── cacheable.decorator.spec.ts  # Decorator tests
│
└── integration/                    # Integration tests (real Redis)
    └── cache.integration.spec.ts  # End-to-end cache tests
```

## Unit Tests

Unit tests are **fast** and **isolated**. They mock all dependencies and test individual components.

### Running Unit Tests

```bash
# Run all unit tests
npm test -- test/unit

# Run specific unit test file
npm test -- test/unit/cache.service.spec.ts

# Run with coverage
npm test -- test/unit --coverage
```

### What Unit Tests Cover

- **cache.service.spec.ts** (49 tests)
  - Public API of CacheService
  - All methods: get, set, del, has, clear, mget, mset, ttl
  - getOrSet and wrap functionality
  - Tag and pattern invalidation
  - Error handling
  - Concurrent operations

- **key-builder.spec.ts** (40 tests)
  - Key building with segments
  - Template interpolation
  - Namespace and versioning
  - Validation rules
  - Custom options (separator, lowercase, etc.)
  - Hash and timestamp generation

- **decorators/cacheable.decorator.spec.ts** (20+ tests)
  - @Cacheable decorator metadata
  - @CachePut decorator metadata
  - @CacheEvict decorator metadata
  - CacheInterceptor behavior
  - Cache hit/miss scenarios
  - Conditional caching
  - Custom key generators
  - Tag-based eviction

## Integration Tests

Integration tests use **real Redis** and test the complete cache stack.

### Prerequisites

Integration tests require a running Redis instance:

```bash
# Option 1: Local Redis
redis-server

# Option 2: Docker
docker run -d -p 6379:6379 redis:7-alpine

# Option 3: Docker Compose
docker-compose up -d redis
```

### Running Integration Tests

```bash
# Run integration tests (requires Redis)
npm test -- test/integration

# Skip integration tests
SKIP_INTEGRATION=true npm test

# Run with custom Redis connection
REDIS_HOST=localhost REDIS_PORT=6379 npm test -- test/integration
```

### What Integration Tests Cover

Integration tests verify real-world scenarios:

- ✅ Basic operations (set, get, del, has, ttl)
- ✅ Batch operations (mget, mset)
- ✅ getOrSet with loader functions
- ✅ wrap for function caching
- ✅ Tag-based invalidation
- ✅ Pattern-based invalidation
- ✅ L1 + L2 dual-layer caching
- ✅ Stampede protection (concurrent loader calls)
- ✅ Cache statistics
- ✅ Complex data types (arrays, nested objects)
- ✅ TTL expiration
- ✅ Error handling

## Running All Tests

```bash
# Run all tests (unit + integration)
npm test

# Run with coverage
npm test -- --coverage

# Run in watch mode
npm test -- --watch

# Run specific pattern
npm test -- cache.service
```

## Test Configuration

Tests are configured in `vitest.config.ts`:

```typescript
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'test/**',
        'examples/**',
        'dist/**',
      ],
    },
  },
});
```

## Environment Variables

- `SKIP_INTEGRATION` - Set to `'true'` to skip integration tests
- `REDIS_HOST` - Redis host (default: `localhost`)
- `REDIS_PORT` - Redis port (default: `6379`)

## Writing Tests

### Unit Test Template

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('MyComponent', () => {
  let component: MyComponent;
  let mockDependency: jest.Mocked<Dependency>;

  beforeEach(() => {
    mockDependency = {
      method: vi.fn(),
    } as any;

    component = new MyComponent(mockDependency);
  });

  describe('method', () => {
    it('should do something', () => {
      // Given
      const input = 'test';
      mockDependency.method.mockReturnValue('result');

      // When
      const result = component.method(input);

      // Then
      expect(result).toBe('result');
      expect(mockDependency.method).toHaveBeenCalledWith(input);
    });
  });
});
```

### Integration Test Template

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';

const describeIntegration = process.env.SKIP_INTEGRATION === 'true'
  ? describe.skip
  : describe;

describeIntegration('Feature Integration', () => {
  let module: TestingModule;
  let service: MyService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [MyModule],
    }).compile();

    service = module.get<MyService>(MyService);
  });

  afterAll(async () => {
    await module?.close();
  });

  it('should work end-to-end', async () => {
    // Given
    const input = 'test';

    // When
    const result = await service.process(input);

    // Then
    expect(result).toBeDefined();
  });
});
```

## Best Practices

### Given-When-Then Structure

All tests follow the Given-When-Then pattern:

```typescript
it('should cache value on set', async () => {
  // Given - Setup
  const key = 'user:123';
  const value = { id: '123', name: 'John' };

  // When - Action
  await cacheService.set(key, value);
  const result = await cacheService.get(key);

  // Then - Assertion
  expect(result).toEqual(value);
});
```

### Test Isolation

- Each test should be independent
- Use `beforeEach` to reset state
- Clean up resources in `afterAll`
- Don't rely on test execution order

### Mocking

Unit tests should mock all external dependencies:

```typescript
const mockDriver = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
} as any;
```

### Async/Await

Always use async/await for asynchronous tests:

```typescript
it('should handle async operations', async () => {
  const result = await service.fetchData();
  expect(result).toBeDefined();
});
```

## Coverage Goals

Target coverage for cache package:

- **Overall**: 90%+
- **Domain layer**: 95%+
- **Application layer**: 90%+
- **Infrastructure layer**: 85%+
- **API layer**: 80%+

## CI/CD Integration

Tests run automatically in CI:

```yaml
# .github/workflows/test.yml
- name: Run tests
  run: npm test
  env:
    SKIP_INTEGRATION: true  # Skip in CI without Redis

- name: Run integration tests
  run: npm test -- test/integration
  services:
    redis:
      image: redis:7-alpine
      ports:
        - 6379:6379
```

## Debugging Tests

```bash
# Run single test with verbose output
npm test -- cache.service.spec.ts -t "should set and get value" --reporter=verbose

# Run with Node debugger
node --inspect-brk node_modules/.bin/vitest run test/unit/cache.service.spec.ts
```

## Common Issues

### Integration Tests Failing

1. Check Redis is running: `redis-cli ping`
2. Check connection: `REDIS_HOST=localhost REDIS_PORT=6379`
3. Clear Redis: `redis-cli FLUSHALL`

### Mocks Not Working

1. Ensure `vi.fn()` is used for Vitest (not `jest.fn()`)
2. Check mock is created in `beforeEach`
3. Verify mock expectations with `.toHaveBeenCalled()`

### Timeout Errors

Increase timeout for slow tests:

```typescript
it('should handle slow operation', async () => {
  // test code
}, 10000); // 10 second timeout
```
