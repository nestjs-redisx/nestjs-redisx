---
title: Installation
description: Install NestJS RedisX and its dependencies
---

# Installation

## Requirements

Before installing NestJS RedisX, ensure your environment meets these requirements:

| Requirement | Version |
|-------------|---------|
| Node.js | 20.x or later |
| NestJS | 10.x or later |
| Redis | 6.x or later |
| TypeScript | 5.0 or later |

::: tip Redis Setup
If you need to install Redis for development:
```bash
# Docker (recommended)
docker run -d --name redis -p 6379:6379 redis:7-alpine

# macOS with Homebrew
brew install redis && brew services start redis

# Ubuntu/Debian
sudo apt-get install redis-server && sudo systemctl start redis
```
:::

## Core Package

Install the core module and your preferred Redis client:

::: code-group

```bash [npm (ioredis)]
npm install @nestjs-redisx/core ioredis
```

```bash [npm (node-redis)]
npm install @nestjs-redisx/core redis
```

```bash [yarn (ioredis)]
yarn add @nestjs-redisx/core ioredis
```

```bash [yarn (node-redis)]
yarn add @nestjs-redisx/core redis
```

```bash [pnpm (ioredis)]
pnpm add @nestjs-redisx/core ioredis
```

```bash [pnpm (node-redis)]
pnpm add @nestjs-redisx/core redis
```

:::

::: info Supported Redis Clients
NestJS RedisX supports both major Node.js Redis clients:

**ioredis** — Battle-tested client used by Alibaba and others
- Redis Cluster and Sentinel support
- Automatic reconnection and failover
- Lua scripting with type safety

**node-redis** — Official Redis client, actively maintained
- Redis Stack and Redis 8 features
- Modern async/await API
- Recommended by Redis team for new projects

Both clients provide full functionality with RedisX. Choose based on your team's preference.
:::

## Plugin Packages

Install only the plugins your application requires:

### Caching

```bash
npm install @nestjs-redisx/cache
```

### Distributed Locks

```bash
npm install @nestjs-redisx/locks
```

### Rate Limiting

```bash
npm install @nestjs-redisx/rate-limit
```

### Idempotency

```bash
npm install @nestjs-redisx/idempotency
```

### Redis Streams

```bash
npm install @nestjs-redisx/streams
```

### Observability

```bash
npm install @nestjs-redisx/metrics @nestjs-redisx/tracing
```

## Complete Installation

For applications requiring all features:

::: code-group

```bash [npm (ioredis)]
npm install @nestjs-redisx/core @nestjs-redisx/cache @nestjs-redisx/locks \
  @nestjs-redisx/rate-limit @nestjs-redisx/idempotency @nestjs-redisx/streams \
  @nestjs-redisx/metrics @nestjs-redisx/tracing ioredis
```

```bash [npm (node-redis)]
npm install @nestjs-redisx/core @nestjs-redisx/cache @nestjs-redisx/locks \
  @nestjs-redisx/rate-limit @nestjs-redisx/idempotency @nestjs-redisx/streams \
  @nestjs-redisx/metrics @nestjs-redisx/tracing redis
```

```bash [yarn (ioredis)]
yarn add @nestjs-redisx/core @nestjs-redisx/cache @nestjs-redisx/locks \
  @nestjs-redisx/rate-limit @nestjs-redisx/idempotency @nestjs-redisx/streams \
  @nestjs-redisx/metrics @nestjs-redisx/tracing ioredis
```

```bash [yarn (node-redis)]
yarn add @nestjs-redisx/core @nestjs-redisx/cache @nestjs-redisx/locks \
  @nestjs-redisx/rate-limit @nestjs-redisx/idempotency @nestjs-redisx/streams \
  @nestjs-redisx/metrics @nestjs-redisx/tracing redis
```

```bash [pnpm (ioredis)]
pnpm add @nestjs-redisx/core @nestjs-redisx/cache @nestjs-redisx/locks \
  @nestjs-redisx/rate-limit @nestjs-redisx/idempotency @nestjs-redisx/streams \
  @nestjs-redisx/metrics @nestjs-redisx/tracing ioredis
```

```bash [pnpm (node-redis)]
pnpm add @nestjs-redisx/core @nestjs-redisx/cache @nestjs-redisx/locks \
  @nestjs-redisx/rate-limit @nestjs-redisx/idempotency @nestjs-redisx/streams \
  @nestjs-redisx/metrics @nestjs-redisx/tracing redis
```

:::

## TypeScript Configuration

Ensure your `tsconfig.json` includes the required compiler options:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true
  }
}
```

::: warning Required Options
The `emitDecoratorMetadata` option is **required** for NestJS dependency injection to function correctly with RedisX plugins.
:::

## Docker Compose

Recommended Docker Compose configuration for local development:

```yaml
# docker-compose.yml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    container_name: redisx-dev
    ports:
      - '6379:6379'
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  redis_data:
```

Start the Redis container:

```bash
docker-compose up -d
```

Verify the connection:

```bash
docker exec -it redisx-dev redis-cli ping
# Expected output: PONG
```

## Verification

Create a simple test to verify the installation:

```typescript
// verify-installation.ts
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
    }),
  ],
})
class TestModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(TestModule);
  console.log('NestJS RedisX connected successfully');
  await app.close();
}

bootstrap().catch(console.error);
```

## Next Steps

- [Quick Start](/en/guide/quick-start) — Create your first cached endpoint
- [Core Module](/en/reference/core/) — RedisModule and RedisService
- [Plugins Overview](/en/reference/plugins/) — Explore available plugins
