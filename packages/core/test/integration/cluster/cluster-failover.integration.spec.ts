import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RedisClientManager } from '../../../src/client/application/redis-client.manager';
import type { IRedisDriver } from '../../../src/interfaces';
import type { IClusterConnectionConfig } from '../../../src/types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Redis Cluster Failover Integration Tests
 *
 * Tests automatic failover when a cluster master node goes down.
 *
 * Prerequisites:
 * 1. Start Redis Cluster: docker compose -f docker-compose.cluster.yml up -d
 * 2. Run tests: npx vitest run test/integration/cluster/cluster-failover.integration.spec.ts
 */
describe('Redis Cluster Failover Integration', () => {
  let manager: RedisClientManager;
  let client: IRedisDriver;

  beforeAll(async () => {
    manager = new RedisClientManager();

    const clusterConfig: IClusterConnectionConfig = {
      type: 'cluster',
      nodes: [
        { host: '127.0.0.1', port: 7001 },
        { host: '127.0.0.1', port: 7002 },
        { host: '127.0.0.1', port: 7003 },
      ],
      connectTimeout: 10000,
      retryStrategy: (times: number) => {
        if (times > 20) return null;
        return Math.min(times * 500, 5000);
      },
      clusterOptions: {
        natMap: {
          '172.28.0.11:7001': { host: '127.0.0.1', port: 7001 },
          '172.28.0.12:7002': { host: '127.0.0.1', port: 7002 },
          '172.28.0.13:7003': { host: '127.0.0.1', port: 7003 },
          '172.28.0.14:7004': { host: '127.0.0.1', port: 7004 },
          '172.28.0.15:7005': { host: '127.0.0.1', port: 7005 },
          '172.28.0.16:7006': { host: '127.0.0.1', port: 7006 },
        },
      },
    };

    client = await manager.createClient('cluster-failover-test', clusterConfig);
    await client.connect();
  }, 30000);

  afterAll(async () => {
    if (manager) {
      await manager.closeAll();
    }
  });

  describe('Master Node Failover', () => {
    it('should survive master node failure and failover to replica', async () => {
      // Given - write data that will be distributed across all masters
      const testData = [
        { key: 'test:failover:user1', value: 'Alice' },
        { key: 'test:failover:user2', value: 'Bob' },
        { key: 'test:failover:user3', value: 'Charlie' },
        { key: 'test:failover:user4', value: 'David' },
        { key: 'test:failover:user5', value: 'Eve' },
      ];

      for (const { key, value } of testData) {
        await client.set(key, value);
      }

      // Verify initial writes
      for (const { key, value } of testData) {
        const result = await client.get(key);
        expect(result).toBe(value);
      }

      // When - kill one master node (redis-cluster-1 on port 7001, holds slots 0-5460)
      console.log('Killing cluster master node 1...');
      await execAsync('docker stop redis-cluster-1');

      // Wait for cluster to detect failure and promote replica (cluster-node-timeout is 5000ms)
      console.log('Waiting for cluster failover (8 seconds)...');
      await new Promise((resolve) => setTimeout(resolve, 8000));

      // Then - should still be able to read/write to other slots
      // Some keys may be on failed node, but others should work
      let successfulReads = 0;
      let successfulWrites = 0;

      for (let i = 0; i < testData.length; i++) {
        const { key, value } = testData[i];

        // Try to read
        try {
          const result = await client.get(key);
          if (result === value) {
            successfulReads++;
          }
        } catch (err) {
          console.log(`Read failed for ${key}: ${err.message}`);
        }

        // Try to write new value
        try {
          await client.set(key, `${value}-updated`);
          successfulWrites++;
        } catch (err) {
          console.log(`Write failed for ${key}: ${err.message}`);
        }
      }

      // Should have some successful operations (keys not on failed node)
      expect(successfulReads).toBeGreaterThan(0);
      expect(successfulWrites).toBeGreaterThan(0);

      // Wait a bit more for replica to fully take over
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Try to write to a key that should definitely work now
      const safeKey = 'test:failover:final';
      let writeSuccess = false;
      for (let retry = 0; retry < 5; retry++) {
        try {
          await client.set(safeKey, 'after-failover');
          const result = await client.get(safeKey);
          expect(result).toBe('after-failover');
          writeSuccess = true;
          break;
        } catch (err) {
          console.log(`Retry ${retry + 1} failed: ${err.message}`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      expect(writeSuccess).toBe(true);

      // Cleanup - restart the failed node (will rejoin as replica)
      console.log('Restarting failed node...');
      await execAsync('docker start redis-cluster-1');
      await new Promise((resolve) => setTimeout(resolve, 10000));

      // Cleanup test data
      for (const { key } of testData) {
        try {
          await client.del(key);
        } catch (err) {
          // Ignore cleanup errors
        }
      }
      try {
        await client.del(safeKey);
      } catch (err) {
        // Ignore
      }
    }, 90000);

    it('should handle cluster resharding after node recovery', async () => {
      // Given - cluster is healthy
      const info = await client.cluster('INFO');
      expect(info).toContain('cluster_state:ok');

      // Write test data
      const keys = Array.from({ length: 10 }, (_, i) => `test:reshard:${i}`);
      for (const key of keys) {
        await client.set(key, `value-${key}`);
      }

      // When - kill a node briefly
      console.log('Killing node for resharding test...');
      await execAsync('docker stop redis-cluster-2');
      await new Promise((resolve) => setTimeout(resolve, 8000));

      // Restart it
      console.log('Restarting node...');
      await execAsync('docker start redis-cluster-2');
      await new Promise((resolve) => setTimeout(resolve, 10000));

      // Then - cluster should recover and all data should be accessible
      let recoveredKeys = 0;
      for (const key of keys) {
        try {
          const value = await client.get(key);
          if (value === `value-${key}`) {
            recoveredKeys++;
          }
        } catch (err) {
          console.log(`Failed to read ${key}: ${err.message}`);
        }
      }

      // Most or all keys should be recoverable
      expect(recoveredKeys).toBeGreaterThan(keys.length * 0.5);

      // Verify cluster is healthy
      const finalInfo = await client.cluster('INFO');
      expect(finalInfo).toContain('cluster_state:ok');

      // Cleanup
      for (const key of keys) {
        try {
          await client.del(key);
        } catch (err) {
          // Ignore
        }
      }
    }, 90000);
  });

  describe('Multiple Node Failures', () => {
    it('should handle losing connection to discovery nodes', async () => {
      // Given - client connected to multiple nodes
      const key = 'test:failover:discovery';
      await client.set(key, 'initial');

      // When - kill the initial discovery nodes (7001, 7002)
      console.log('Killing initial discovery nodes...');
      await execAsync('docker stop redis-cluster-1 redis-cluster-2');
      await new Promise((resolve) => setTimeout(resolve, 8000));

      // Then - should still work via other nodes
      let success = false;
      for (let retry = 0; retry < 10; retry++) {
        try {
          // Client should discover other nodes and continue working
          await client.set(key, 'after-discovery-loss');
          const result = await client.get(key);
          if (result === 'after-discovery-loss') {
            success = true;
            break;
          }
        } catch (err) {
          console.log(`Discovery retry ${retry + 1}: ${err.message}`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      expect(success).toBe(true);

      // Cleanup - restart all nodes
      console.log('Restarting all nodes...');
      await execAsync('docker start redis-cluster-1 redis-cluster-2');
      await new Promise((resolve) => setTimeout(resolve, 15000));

      try {
        await client.del(key);
      } catch (err) {
        // Ignore
      }
    }, 120000);
  });
});
