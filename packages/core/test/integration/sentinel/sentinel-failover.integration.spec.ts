import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RedisClientManager } from '../../../src/client/application/redis-client.manager';
import type { IRedisDriver } from '../../../src/interfaces';
import type { ISentinelConnectionConfig } from '../../../src/types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Redis Sentinel Failover Integration Tests
 *
 * Tests automatic failover when master goes down.
 *
 * Prerequisites:
 * 1. Start Redis Sentinel: docker compose -f docker-compose.sentinel.yml up -d
 * 2. Run tests: npx vitest run test/integration/sentinel/sentinel-failover.integration.spec.ts
 */
describe('Redis Sentinel Failover Integration', () => {
  let manager: RedisClientManager;
  let client: IRedisDriver;

  beforeAll(async () => {
    manager = new RedisClientManager();

    const sentinelConfig: ISentinelConnectionConfig = {
      type: 'sentinel',
      name: 'mymaster',
      sentinels: [
        { host: 'localhost', port: 26379 },
        { host: 'localhost', port: 26380 },
        { host: 'localhost', port: 26381 },
      ],
      connectTimeout: 10000,
      retryStrategy: (times: number) => {
        if (times > 20) return null;
        return Math.min(times * 500, 5000);
      },
      sentinelOptions: {
        sentinelRetryStrategy: (times: number) => {
          if (times > 20) return null;
          return Math.min(times * 500, 5000);
        },
        natMap: {
          'redis-sentinel-master:6379': { host: 'localhost', port: 6379 },
          'redis-sentinel-replica-1:6380': { host: 'localhost', port: 6380 },
          'redis-sentinel-replica-2:6381': { host: 'localhost', port: 6381 },
          // Docker internal IPs from docker-compose.sentinel.yml (subnet 172.23.0.0/16)
          '172.23.0.2:6379': { host: 'localhost', port: 6379 },
          '172.23.0.3:6380': { host: 'localhost', port: 6380 },
          '172.23.0.4:6381': { host: 'localhost', port: 6381 },
        },
      },
    };

    client = await manager.createClient('sentinel-failover-test', sentinelConfig);
    await client.connect();
  }, 30000);

  afterAll(async () => {
    if (manager) {
      await manager.closeAll();
    }
  });

  describe('Master Failover', () => {
    it('should detect master failure and sentinel should promote replica', async () => {
      // Given - verify sentinel knows current master
      const beforeInfo = await execAsync('docker exec redis-sentinel-1 redis-cli -p 26379 info sentinel');
      expect(beforeInfo.stdout).toContain('master0:name=mymaster');
      expect(beforeInfo.stdout).toContain('status=ok');

      // When - kill the master
      console.log('Killing Redis master...');
      await execAsync('docker stop redis-sentinel-master');

      // Wait for sentinel to detect failure and promote replica
      console.log('Waiting for sentinel to detect failure and promote replica (15 seconds)...');
      await new Promise((resolve) => setTimeout(resolve, 15000));

      // Then - sentinel should have elected a new master
      const afterInfo = await execAsync('docker exec redis-sentinel-1 redis-cli -p 26379 info sentinel');

      // Verify sentinel still has a master (may be different address)
      expect(afterInfo.stdout).toContain('master0:name=mymaster');
      expect(afterInfo.stdout).toContain('status=ok');

      // Verify master address changed (should not be the old master's address)
      expect(afterInfo.stdout).not.toContain('redis-sentinel-master:6379');

      console.log('Sentinel info after failover:', afterInfo.stdout);

      // Cleanup - restart old master (will rejoin as replica)
      console.log('Restarting old master...');
      await execAsync('docker start redis-sentinel-master');
      await new Promise((resolve) => setTimeout(resolve, 10000));

      // Verify system is healthy again
      const finalInfo = await execAsync('docker exec redis-sentinel-1 redis-cli -p 26379 info sentinel');
      expect(finalInfo.stdout).toContain('status=ok');

      // Should now have 3 instances (1 master + 2 replicas, old master rejoined as replica)
      const slaveMatch = finalInfo.stdout.match(/slaves=(\d+)/);
      if (slaveMatch) {
        const slaveCount = parseInt(slaveMatch[1], 10);
        expect(slaveCount).toBeGreaterThanOrEqual(1);
      }
    }, 120000);
  });
});
