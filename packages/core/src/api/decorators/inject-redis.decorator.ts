import { Inject } from '@nestjs/common';

import { getClientToken, DEFAULT_CLIENT_NAME } from '../../shared/constants';

/**
 * Injects Redis driver by name.
 *
 * Use this decorator to inject a specific Redis client into your service.
 * If no name is provided, the default client is injected.
 *
 * @param name - Client name (default: 'default')
 * @returns Property decorator
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class CacheService {
 *   constructor(
 *     @InjectRedis() private readonly redis: IRedisDriver,
 *     @InjectRedis('sessions') private readonly sessions: IRedisDriver,
 *   ) {}
 *
 *   async cacheUser(id: string, data: User): Promise<void> {
 *     await this.redis.set(`user:${id}`, JSON.stringify(data), { ex: 3600 });
 *   }
 *
 *   async getSession(id: string): Promise<string | null> {
 *     return this.sessions.get(`session:${id}`);
 *   }
 * }
 * ```
 */
export function InjectRedis(name: string = DEFAULT_CLIENT_NAME): ParameterDecorator {
  return Inject(getClientToken(name));
}
