/**
 * Unit tests for @InjectRedis decorator.
 *
 * The @InjectRedis decorator is a convenience wrapper around @Inject that
 * injects a Redis driver by name using the proper injection token.
 */

import { describe, it, expect } from 'vitest';
import { InjectRedis } from '../../src/api/decorators/inject-redis.decorator';
import { getClientToken, DEFAULT_CLIENT_NAME } from '../../src/shared/constants';

describe('InjectRedis Decorator', () => {
  describe('Token Generation', () => {
    it('should generate token for default client', () => {
      // When
      const token = getClientToken(DEFAULT_CLIENT_NAME);

      // Then
      expect(typeof token).toBe('symbol');
      expect(token.toString()).toContain('REDIS_CLIENT');
      expect(token.toString()).toContain(DEFAULT_CLIENT_NAME);
    });

    it('should generate token for named client', () => {
      // Given
      const clientName = 'sessions';

      // When
      const token = getClientToken(clientName);

      // Then
      expect(typeof token).toBe('symbol');
      expect(token.toString()).toContain('REDIS_CLIENT');
      expect(token.toString()).toContain(clientName);
    });

    it('should return same token for same client name', () => {
      // When
      const token1 = getClientToken('cache');
      const token2 = getClientToken('cache');

      // Then
      // Symbol.for() returns the same symbol for the same key
      expect(token1).toBe(token2);
      expect(typeof token1).toBe('symbol');
      expect(typeof token2).toBe('symbol');
    });

    it('should create different tokens for different client names', () => {
      // When
      const token1 = getClientToken('cache');
      const token2 = getClientToken('sessions');
      const token3 = getClientToken(DEFAULT_CLIENT_NAME);

      // Then
      expect(token1).not.toBe(token2);
      expect(token2).not.toBe(token3);
      expect(token1).not.toBe(token3);
      expect(token1.toString()).toContain('cache');
      expect(token2.toString()).toContain('sessions');
      expect(token3.toString()).toContain(DEFAULT_CLIENT_NAME);
    });
  });

  describe('Multiple Injections', () => {
    it('should support multiple @InjectRedis decorators in same class', () => {
      // Given
      class MultiClientService {
        constructor(
          @InjectRedis() private readonly defaultClient: any,
          @InjectRedis('cache') private readonly cache: any,
          @InjectRedis('sessions') private readonly sessions: any,
        ) {}
      }

      // When - Get tokens
      const defaultToken = getClientToken(DEFAULT_CLIENT_NAME);
      const cacheToken = getClientToken('cache');
      const sessionsToken = getClientToken('sessions');

      // Then - Tokens should be symbols with expected descriptions
      expect(typeof defaultToken).toBe('symbol');
      expect(typeof cacheToken).toBe('symbol');
      expect(typeof sessionsToken).toBe('symbol');
      expect(defaultToken.toString()).toContain('default');
      expect(cacheToken.toString()).toContain('cache');
      expect(sessionsToken.toString()).toContain('sessions');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string as client name', () => {
      // Given
      const emptyName = '';

      // When
      const token = getClientToken(emptyName);

      // Then
      expect(typeof token).toBe('symbol');
      expect(token.toString()).toBe('Symbol(REDIS_CLIENT:)');
    });

    it('should handle client names with special characters', () => {
      // Given
      const specialNames = ['cache:v2', 'user-sessions', 'db_primary', 'app.redis'];

      // When & Then
      specialNames.forEach((name) => {
        const token = getClientToken(name);
        expect(typeof token).toBe('symbol');
        expect(token.toString()).toContain(name);
      });
    });

    it('should handle client names with spaces', () => {
      // Given
      const nameWithSpaces = 'my cache';

      // When
      const token = getClientToken(nameWithSpaces);

      // Then
      expect(typeof token).toBe('symbol');
      expect(token.toString()).toContain(nameWithSpaces);
    });

    it('should handle very long client names', () => {
      // Given
      const longName = 'a'.repeat(1000);

      // When
      const token = getClientToken(longName);

      // Then
      expect(typeof token).toBe('symbol');
      expect(token.toString()).toContain(longName);
    });

    it('should handle Unicode characters in client names', () => {
      // Given
      const unicodeNames = ['кэш', '缓存', 'キャッシュ', '🚀rocket'];

      // When & Then
      unicodeNames.forEach((name) => {
        const token = getClientToken(name);
        expect(typeof token).toBe('symbol');
        expect(token.toString()).toContain(name);
      });
    });
  });

  describe('Type Safety', () => {
    it('should work with typed Redis driver', () => {
      // This is a compile-time test - if TypeScript compiles, it passes
      interface IRedisDriver {
        get(key: string): Promise<string | null>;
        set(key: string, value: string): Promise<'OK'>;
      }

      class TypedService {
        constructor(@InjectRedis() private readonly redis: IRedisDriver) {}

        async test(): Promise<void> {
          // These should compile without errors
          await this.redis.get('key');
          await this.redis.set('key', 'value');
        }
      }

      // Then - no TypeScript errors
      expect(TypedService).toBeDefined();
    });
  });

  describe('Decorator Returns ParameterDecorator', () => {
    it('should return a parameter decorator function', () => {
      // Given
      const decorator = InjectRedis();

      // Then
      expect(typeof decorator).toBe('function');
    });

    it('should be usable as parameter decorator', () => {
      // Given/When - This should compile and run without errors
      class TestService {
        constructor(@InjectRedis() private readonly redis: any) {
          expect(redis).toBeUndefined(); // Not actually injected in test
        }
      }

      // Then
      expect(TestService).toBeDefined();
    });
  });

  describe('Integration with NestJS DI', () => {
    it('should generate symbols for NestJS DI', () => {
      // Given
      const clientNames = ['default', 'cache', 'sessions', 'queue'];

      // When & Then
      clientNames.forEach((name) => {
        const token = getClientToken(name);

        // Token should be a symbol (required for NestJS DI)
        expect(typeof token).toBe('symbol');

        // Token description should follow the naming pattern
        expect(token.toString()).toMatch(/^Symbol\(REDIS_CLIENT:/);

        // Token description should include the client name
        expect(token.toString()).toContain(name);
      });
    });

    it('should return stable tokens for same client name', () => {
      // Given
      const clientName = 'consistent';

      // When
      const token1 = getClientToken(clientName);
      const token2 = getClientToken(clientName);
      const token3 = getClientToken(clientName);

      // Then - Symbol.for() returns the same symbol for the same key
      expect(token1).toBe(token2);
      expect(token2).toBe(token3);
      expect(token1).toBe(token3);

      // And they should have the expected description
      expect(token1.toString()).toContain('consistent');
    });
  });

  describe('Usage Examples', () => {
    it('should work in basic service', () => {
      // Given
      class CacheService {
        constructor(@InjectRedis() private readonly redis: any) {}
      }

      // Then
      expect(CacheService).toBeDefined();
      const token = getClientToken(DEFAULT_CLIENT_NAME);
      expect(typeof token).toBe('symbol');
    });

    it('should work with named client', () => {
      // Given
      class SessionService {
        constructor(@InjectRedis('sessions') private readonly redis: any) {}
      }

      // Then
      expect(SessionService).toBeDefined();
      const token = getClientToken('sessions');
      expect(typeof token).toBe('symbol');
    });

    it('should work with multiple named clients', () => {
      // Given
      class MultiService {
        constructor(
          @InjectRedis('cache') private readonly cache: any,
          @InjectRedis('queue') private readonly queue: any,
        ) {}
      }

      // Then
      expect(MultiService).toBeDefined();
      const cacheToken = getClientToken('cache');
      const queueToken = getClientToken('queue');
      expect(typeof cacheToken).toBe('symbol');
      expect(typeof queueToken).toBe('symbol');
    });
  });

  describe('Default Value Behavior', () => {
    it('should use DEFAULT_CLIENT_NAME when called without arguments', () => {
      // When
      const token = getClientToken(DEFAULT_CLIENT_NAME);

      // Then
      expect(typeof token).toBe('symbol');
      expect(token.toString()).toContain(DEFAULT_CLIENT_NAME);
      expect(DEFAULT_CLIENT_NAME).toBe('default');
    });

    it('should create different tokens for default vs custom names', () => {
      // Given
      const customName = 'custom';

      // When
      const defaultToken = getClientToken(DEFAULT_CLIENT_NAME);
      const customToken = getClientToken(customName);

      // Then
      expect(typeof defaultToken).toBe('symbol');
      expect(typeof customToken).toBe('symbol');
      expect(defaultToken).not.toBe(customToken);
      expect(defaultToken.toString()).toContain('default');
      expect(customToken.toString()).toContain('custom');
    });
  });
});
