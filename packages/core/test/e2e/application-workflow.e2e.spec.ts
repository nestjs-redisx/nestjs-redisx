import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RedisClientManager } from '../../src/client/application/redis-client.manager';
import { ConnectionConfig } from '../../src/types';

/**
 * Application Workflow E2E Tests
 *
 * Prerequisites:
 * 1. Start Redis: npm run docker:redis:up
 * 2. Run tests: npm run test:e2e
 *
 * Tests real-world application workflows:
 * - User management with caching
 * - Shopping cart operations
 * - Session management
 * - Multi-client scenarios
 */
describe('Application Workflow E2E', () => {
  let manager: RedisClientManager;
  let client: any;

  const config: ConnectionConfig = {
    driver: 'ioredis',
    connectionType: 'standalone',
    host: 'localhost',
    port: 6379,
  };

  beforeAll(async () => {
    manager = new RedisClientManager();
    client = await manager.createClient('main', config);
    await client.connect();
  });

  afterAll(async () => {
    if (manager) {
      await manager.closeAll();
    }
  });

  describe('User Management Workflow', () => {
    it('should cache user data with expiration', async () => {
      // Given
      const userId = 1;
      const userData = {
        id: userId,
        name: 'John Doe',
        email: 'john@example.com',
        role: 'admin',
      };

      // When - cache user
      await client.set(`user:${userId}`, JSON.stringify(userData), { ex: 3600 });
      const cached = await client.get(`user:${userId}`);

      // Then
      expect(JSON.parse(cached)).toEqual(userData);

      const ttl = await client.ttl(`user:${userId}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(3600);

      // Cleanup
      await client.del(`user:${userId}`);
    });

    it('should track user login count', async () => {
      // Given
      const userId = 2;

      // When - simulate multiple logins
      const count1 = await client.incr(`user:${userId}:logins`);
      const count2 = await client.incr(`user:${userId}:logins`);
      const count3 = await client.incr(`user:${userId}:logins`);

      // Then
      expect(count1).toBe(1);
      expect(count2).toBe(2);
      expect(count3).toBe(3);

      // Cleanup
      await client.del(`user:${userId}:logins`);
    });

    it('should track user activity with timestamps', async () => {
      // Given
      const userId = 3;
      const activities = [
        { action: 'login', timestamp: Date.now() },
        { action: 'view_profile', timestamp: Date.now() + 1000 },
        { action: 'update_settings', timestamp: Date.now() + 2000 },
      ];

      // When - track activities
      for (const activity of activities) {
        await client.zadd(`user:${userId}:activity`, activity.timestamp, `${activity.action}:${activity.timestamp}`);
      }
      await client.expire(`user:${userId}:activity`, 86400);

      // Then
      const count = await client.zcard(`user:${userId}:activity`);
      expect(count).toBe(3);

      const recentActivities = await client.zrange(`user:${userId}:activity`, 0, -1);
      expect(recentActivities).toHaveLength(3);

      // Cleanup
      await client.del(`user:${userId}:activity`);
    });
  });

  describe('Shopping Cart Workflow', () => {
    it('should manage cart items with hashes', async () => {
      // Given
      const userId = 100;
      const cart = {
        '1001': '2', // Product 1001: quantity 2
        '1002': '1', // Product 1002: quantity 1
        '1003': '5', // Product 1003: quantity 5
      };

      // When - add items to cart
      for (const [productId, quantity] of Object.entries(cart)) {
        await client.hset(`cart:${userId}`, productId, quantity);
      }
      await client.expire(`cart:${userId}`, 86400);

      // Then
      const retrievedCart = await client.hgetall(`cart:${userId}`);
      expect(retrievedCart).toEqual(cart);

      // Cleanup
      await client.del(`cart:${userId}`);
    });

    it('should update cart item quantities', async () => {
      // Given
      const userId = 101;
      await client.hset(`cart:${userId}`, '1001', '2');

      // When - update quantity
      await client.hset(`cart:${userId}`, '1001', '5');
      const newQuantity = await client.hget(`cart:${userId}`, '1001');

      // Then
      expect(newQuantity).toBe('5');

      // Cleanup
      await client.del(`cart:${userId}`);
    });

    it('should remove items from cart', async () => {
      // Given
      const userId = 102;
      await client.hset(`cart:${userId}`, '1001', '2');
      await client.hset(`cart:${userId}`, '1002', '1');

      // When - remove one item
      await client.hdel(`cart:${userId}`, '1001');
      const cart = await client.hgetall(`cart:${userId}`);

      // Then
      expect(cart).toEqual({ '1002': '1' });
      expect(cart['1001']).toBeUndefined();

      // Cleanup
      await client.del(`cart:${userId}`);
    });

    it('should clear entire cart', async () => {
      // Given
      const userId = 103;
      await client.hset(`cart:${userId}`, '1001', '2');
      await client.hset(`cart:${userId}`, '1002', '1');

      // When - clear cart
      await client.del(`cart:${userId}`);
      const cart = await client.hgetall(`cart:${userId}`);

      // Then
      expect(cart).toEqual({});
    });
  });

  describe('Session Management Workflow', () => {
    it('should store and retrieve session data', async () => {
      // Given
      const sessionId = 'sess_abc123';
      const sessionData = {
        userId: 1,
        username: 'john_doe',
        roles: ['user', 'admin'],
        loginAt: Date.now(),
      };

      // When - store session
      await client.set(`session:${sessionId}`, JSON.stringify(sessionData), 'EX', 3600);

      // Then - retrieve session
      const retrieved = await client.get(`session:${sessionId}`);
      expect(JSON.parse(retrieved)).toEqual(sessionData);

      // Cleanup
      await client.del(`session:${sessionId}`);
    });

    it('should handle session expiration', async () => {
      // Given
      const sessionId = 'sess_xyz789';
      const sessionData = { userId: 2 };

      // When - create session with short TTL
      await client.set(`session:${sessionId}`, JSON.stringify(sessionData), { ex: 60 });

      // Then - verify TTL
      const ttl = await client.ttl(`session:${sessionId}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);

      // Cleanup
      await client.del(`session:${sessionId}`);
    });

    it('should extend session TTL', async () => {
      // Given
      const sessionId = 'sess_extend';
      await client.set(`session:${sessionId}`, 'data', { ex: 60 });

      // When - extend TTL
      await client.expire(`session:${sessionId}`, 3600);

      // Then
      const ttl = await client.ttl(`session:${sessionId}`);
      expect(ttl).toBeGreaterThan(60);

      // Cleanup
      await client.del(`session:${sessionId}`);
    });
  });

  describe('Multi-Client Workflow', () => {
    it('should handle multiple database instances', async () => {
      // Given - create clients for different databases
      const cacheClient = await manager.createClient('cache', {
        ...config,
        db: 0,
      });
      const sessionClient = await manager.createClient('sessions', {
        ...config,
        db: 1,
      });

      await cacheClient.connect();
      await sessionClient.connect();

      // When - write to both databases
      await cacheClient.set('cache:key', 'cached-value');
      await sessionClient.set('session:key', 'session-value');

      // Then - verify isolation
      const cacheValue = await cacheClient.get('cache:key');
      const sessionValue = await sessionClient.get('session:key');

      expect(cacheValue).toBe('cached-value');
      expect(sessionValue).toBe('session-value');

      // Verify isolation - cache client shouldn't see session data
      const sessionInCache = await cacheClient.get('session:key');
      expect(sessionInCache).toBeNull();

      // Cleanup
      await cacheClient.del('cache:key');
      await sessionClient.del('session:key');
      await manager.closeClient('cache');
      await manager.closeClient('sessions');
    });
  });

  describe('Complete User Journey', () => {
    it('should handle full user session from login to logout', async () => {
      // Given
      const userId = 200;
      const sessionId = 'sess_journey';

      // Step 1: User logs in
      const loginCount = await client.incr(`user:${userId}:logins`);
      expect(loginCount).toBeGreaterThan(0);

      // Step 2: Create session
      const sessionData = {
        userId,
        loginAt: Date.now(),
        ip: '192.168.1.1',
      };
      await client.set(`session:${sessionId}`, JSON.stringify(sessionData), 'EX', 3600);

      // Step 3: Track login activity
      await client.zadd(`user:${userId}:activity`, Date.now(), `login:${Date.now()}`);

      // Step 4: User adds items to cart
      await client.hset(`cart:${userId}`, '1001', '2');
      await client.hset(`cart:${userId}`, '1002', '1');

      // Step 5: User views product
      await client.zadd(`user:${userId}:activity`, Date.now() + 1000, `view_product:${Date.now() + 1000}`);

      // Step 6: Verify all data
      const session = await client.get(`session:${sessionId}`);
      const cart = await client.hgetall(`cart:${userId}`);
      const activityCount = await client.zcard(`user:${userId}:activity`);

      expect(JSON.parse(session)).toEqual(sessionData);
      expect(cart).toEqual({ '1001': '2', '1002': '1' });
      expect(activityCount).toBe(2);

      // Step 7: User logs out - cleanup session but keep cart
      await client.del(`session:${sessionId}`);

      const sessionAfterLogout = await client.get(`session:${sessionId}`);
      const cartAfterLogout = await client.hgetall(`cart:${userId}`);

      expect(sessionAfterLogout).toBeNull();
      expect(cartAfterLogout).toEqual({ '1001': '2', '1002': '1' });

      // Cleanup
      await client.del(`cart:${userId}`);
      await client.del(`user:${userId}:logins`);
      await client.del(`user:${userId}:activity`);
    });
  });

  describe('Health Check and Statistics', () => {
    it('should perform health check on client', async () => {
      // When
      const health = await manager.healthCheck('main');

      // Then
      expect(health).toBeDefined();
      expect(health.healthy).toBe(true);
      expect(health.status).toBeDefined();
      expect(health.metadata).toBeDefined();
    });

    it('should provide client statistics', async () => {
      // Given - perform some operations
      await client.set('stats:test', 'value');
      await client.get('stats:test');
      await client.del('stats:test');

      // When
      const stats = manager.getStats();

      // Then
      expect(stats.totalClients).toBeGreaterThan(0);
      expect(stats.clients['main']).toBeDefined();
      expect(stats.clients['main'].status).toBeDefined();
      expect(stats.clients['main'].commandsExecuted).toBeGreaterThan(0);
    });
  });
});
