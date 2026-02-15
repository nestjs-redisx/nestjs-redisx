<p align="center">
  <img src="https://raw.githubusercontent.com/nestjs-redisx/nestjs-redisx/main/website/public/images/logo.png" alt="NestJS RedisX" />
</p>

# @nestjs-redisx/cache

[![npm](https://img.shields.io/npm/v/@nestjs-redisx/cache)](https://www.npmjs.com/package/@nestjs-redisx/cache)
[![npm downloads](https://img.shields.io/npm/dm/@nestjs-redisx/cache)](https://www.npmjs.com/package/@nestjs-redisx/cache)
[![license](https://img.shields.io/npm/l/@nestjs-redisx/cache)](https://opensource.org/licenses/MIT)

Two-tier caching plugin for NestJS RedisX. L1 in-memory + L2 Redis with anti-stampede protection, stale-while-revalidate (SWR), tag-based invalidation, and declarative `@Cached` decorator.

## Installation

```bash
npm install @nestjs-redisx/core @nestjs-redisx/cache ioredis
```

## Quick Example

```typescript
import { RedisModule } from '@nestjs-redisx/core';
import { CachePlugin, Cached } from '@nestjs-redisx/cache';

@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [new CachePlugin({ l1: { maxSize: 1000 }, l2: { defaultTtl: 3600 } })],
    }),
  ],
})
export class AppModule {}

@Injectable()
export class UserService {
  @Cached({ key: 'user:{0}', ttl: 300, tags: ['users'] })
  async getUser(id: string) {
    return this.repo.findById(id);
  }
}
```

## Documentation

Full documentation: [nestjs-redisx.dev/en/reference/cache/](https://nestjs-redisx.dev/en/reference/cache/)

## License

MIT
