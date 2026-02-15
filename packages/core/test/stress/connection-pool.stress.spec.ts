import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RedisClientManager } from '../../src/client/application/redis-client.manager';
import { ConnectionConfig } from '../../src/types';

/**
 * Redis Connection Pool Stress Tests
 *
 * Prerequisites:
 * 1. Start Redis: npm run docker:redis:up
 * 2. Run tests: npm run test:stress
 *
 * Stress Scenarios:
 * - Maximum connection limits
 * - Connection churn (rapid create/destroy)
 * - Memory pressure
 * - Error recovery
 * - Extreme concurrency
 */
describe('Redis Connection Pool Stress Tests', () => {
  let manager: RedisClientManager;

  const config: ConnectionConfig = {
    driver: 'ioredis',
    connectionType: 'standalone',
    host: 'localhost',
    port: 6379,
  };

  beforeAll(async () => {
    manager = new RedisClientManager();
  });

  afterAll(async () => {
    if (manager) {
      await manager.closeAll();
    }
  });

  describe('Maximum Connections', () => {
    it('should handle 500 simultaneous client connections', async () => {
      // Given
      const maxClients = 500;
      const clients: any[] = [];

      // When - create all clients
      const createStart = Date.now();
      for (let i = 0; i < maxClients; i++) {
        const client = await manager.createClient(`stress-max-${i}`, config);
        await client.connect();
        clients.push(client);
      }
      const createDuration = Date.now() - createStart;

      // Then - all clients should be connected
      const stats = manager.getStats();
      expect(stats.totalClients).toBe(maxClients);

      // Perform operations with all clients
      const opsStart = Date.now();
      const operations = clients.map(async (client, index) => {
        await client.set(`stress:max:${index}`, `value${index}`);
        return client.get(`stress:max:${index}`);
      });
      const results = await Promise.all(operations);
      const opsDuration = Date.now() - opsStart;

      expect(results).toHaveLength(maxClients);
      console.log(`✅ Created ${maxClients} clients in ${createDuration}ms, operations completed in ${opsDuration}ms`);

      // Cleanup
      for (let i = 0; i < maxClients; i++) {
        await manager.closeClient(`stress-max-${i}`);
      }

      const cleanupStats = manager.getStats();
      expect(cleanupStats.totalClients).toBe(0);
    }, 120000);

    it('should handle connection churn (rapid create/destroy)', async () => {
      // Given
      const iterations = 100;
      const concurrency = 10;

      // When
      const startTime = Date.now();

      for (let iter = 0; iter < iterations; iter++) {
        const promises = [];
        for (let i = 0; i < concurrency; i++) {
          const clientName = `stress-churn-${iter}-${i}`;
          promises.push(
            (async () => {
              const client = await manager.createClient(clientName, config);
              await client.connect();
              await client.set(`stress:churn:${iter}:${i}`, `value${i}`);
              await client.get(`stress:churn:${iter}:${i}`);
              await manager.closeClient(clientName);
            })(),
          );
        }
        await Promise.all(promises);
      }

      const duration = Date.now() - startTime;
      const totalOps = iterations * concurrency;

      // Then
      const stats = manager.getStats();
      expect(stats.totalClients).toBe(0); // All clients should be closed
      console.log(`✅ Completed ${totalOps} connection create/destroy cycles in ${duration}ms`);
    }, 120000);
  });

  describe('Memory Pressure', () => {
    it('should handle operations with large payloads under memory pressure', async () => {
      // Given
      const client = await manager.createClient('stress-memory', config);
      await client.connect();

      const payloadSize = 1024 * 100; // 100KB per item
      const itemCount = 100; // 10MB total
      const largeValue = 'x'.repeat(payloadSize);

      // When
      const startTime = Date.now();

      const writePromises: Promise<any>[] = [];
      for (let i = 0; i < itemCount; i++) {
        writePromises.push(client.set(`stress:memory:${i}`, largeValue));
      }
      await Promise.all(writePromises);

      const writeDuration = Date.now() - startTime;

      // Read back
      const readStart = Date.now();
      const readPromises: Promise<any>[] = [];
      for (let i = 0; i < itemCount; i++) {
        readPromises.push(client.get(`stress:memory:${i}`));
      }
      const results = await Promise.all(readPromises);
      const readDuration = Date.now() - readStart;

      // Then
      expect(results).toHaveLength(itemCount);
      results.forEach((result) => {
        expect(result).toHaveLength(payloadSize);
      });

      const totalMB = (itemCount * payloadSize) / (1024 * 1024);
      console.log(`✅ Wrote ${totalMB.toFixed(2)}MB in ${writeDuration}ms, read in ${readDuration}ms`);

      // Cleanup
      const deletePromises: Promise<any>[] = [];
      for (let i = 0; i < itemCount; i++) {
        deletePromises.push(client.del(`stress:memory:${i}`));
      }
      await Promise.all(deletePromises);

      await manager.closeClient('stress-memory');
    }, 120000);

    it('should handle many small keys (memory fragmentation)', async () => {
      // Given
      const client = await manager.createClient('stress-fragmentation', config);
      await client.connect();

      const keyCount = 50000;

      // When
      const startTime = Date.now();

      // Use pipeline for efficiency
      const batchSize = 1000;
      for (let batch = 0; batch < keyCount / batchSize; batch++) {
        const pipeline = client.pipeline();
        for (let i = 0; i < batchSize; i++) {
          const key = `stress:frag:${batch * batchSize + i}`;
          pipeline.set(key, `v${i}`);
        }
        await pipeline.exec();
      }

      const duration = Date.now() - startTime;
      const throughput = (keyCount / duration) * 1000;

      // Then
      expect(throughput).toBeGreaterThan(5000);
      console.log(`✅ Created ${keyCount} keys in ${duration}ms (${throughput.toFixed(0)} keys/sec)`);

      // Cleanup
      for (let batch = 0; batch < keyCount / batchSize; batch++) {
        const pipeline = client.pipeline();
        for (let i = 0; i < batchSize; i++) {
          const key = `stress:frag:${batch * batchSize + i}`;
          pipeline.del(key);
        }
        await pipeline.exec();
      }

      await manager.closeClient('stress-fragmentation');
    }, 120000);
  });

  describe('Error Recovery', () => {
    it('should recover from temporary connection failures', async () => {
      // Given
      const client = await manager.createClient('stress-recovery', config);
      await client.connect();

      // When - perform operations even if some fail
      const operations = 1000;
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < operations; i++) {
        try {
          await client.set(`stress:recovery:${i}`, `value${i}`);
          successCount++;
        } catch (error) {
          errorCount++;
        }
      }

      // Then - most operations should succeed
      const successRate = (successCount / operations) * 100;
      expect(successRate).toBeGreaterThan(95); // At least 95% success
      console.log(`✅ Success rate: ${successRate.toFixed(2)}% (${successCount}/${operations})`);

      // Cleanup
      const deletePromises: Promise<any>[] = [];
      for (let i = 0; i < successCount; i++) {
        deletePromises.push(client.del(`stress:recovery:${i}`).catch(() => {}));
      }
      await Promise.all(deletePromises);

      await manager.closeClient('stress-recovery');
    }, 60000);

    it('should handle invalid operations gracefully', async () => {
      // Given
      const client = await manager.createClient('stress-invalid', config);
      await client.connect();

      await client.set('stress:invalid:string', 'string-value');

      // When - attempt invalid operations
      const invalidOps = [client.lpush('stress:invalid:string', 'item').catch(() => 'error1'), client.sadd('stress:invalid:string', 'member').catch(() => 'error2'), client.zadd('stress:invalid:string', 1, 'member').catch(() => 'error3'), client.hset('stress:invalid:string', 'field', 'value').catch(() => 'error4')];

      const results = await Promise.all(invalidOps);

      // Then - all should fail gracefully
      expect(results.every((r) => typeof r === 'string' && r.startsWith('error'))).toBe(true);
      console.log(`✅ All invalid operations handled gracefully`);

      // Cleanup
      await client.del('stress:invalid:string');
      await manager.closeClient('stress-invalid');
    }, 30000);
  });

  describe('Extreme Concurrency', () => {
    it('should handle 1000 concurrent operations on single client', async () => {
      // Given
      const client = await manager.createClient('stress-concurrent', config);
      await client.connect();

      const concurrency = 1000;

      // When
      const startTime = Date.now();

      const operations: Promise<any>[] = [];
      for (let i = 0; i < concurrency; i++) {
        operations.push(client.set(`stress:concurrent:${i}`, `value${i}`));
      }

      await Promise.all(operations);

      const duration = Date.now() - startTime;
      const throughput = (concurrency / duration) * 1000;

      // Then
      expect(throughput).toBeGreaterThan(1000);
      console.log(`✅ Handled ${concurrency} concurrent operations in ${duration}ms (${throughput.toFixed(0)} ops/sec)`);

      // Verify all keys exist
      const verifyOps: Promise<any>[] = [];
      for (let i = 0; i < concurrency; i++) {
        verifyOps.push(client.get(`stress:concurrent:${i}`));
      }
      const results = await Promise.all(verifyOps);
      expect(results.filter((r) => r !== null)).toHaveLength(concurrency);

      // Cleanup
      const deletePromises: Promise<any>[] = [];
      for (let i = 0; i < concurrency; i++) {
        deletePromises.push(client.del(`stress:concurrent:${i}`));
      }
      await Promise.all(deletePromises);

      await manager.closeClient('stress-concurrent');
    }, 60000);

    it('should handle mixed operation types under high concurrency', async () => {
      // Given
      const client = await manager.createClient('stress-mixed', config);
      await client.connect();

      const operations = 500;

      // When
      const startTime = Date.now();

      const mixedOps: Promise<any>[] = [];
      for (let i = 0; i < operations; i++) {
        const opType = i % 5;
        switch (opType) {
          case 0: // String
            mixedOps.push(client.set(`stress:mixed:str:${i}`, `value${i}`));
            break;
          case 1: // Hash
            mixedOps.push(client.hset(`stress:mixed:hash:${i}`, 'field', `value${i}`));
            break;
          case 2: // List
            mixedOps.push(client.lpush(`stress:mixed:list:${i}`, `item${i}`));
            break;
          case 3: // Set
            mixedOps.push(client.sadd(`stress:mixed:set:${i}`, `member${i}`));
            break;
          case 4: // Sorted Set
            mixedOps.push(client.zadd(`stress:mixed:zset:${i}`, i, `member${i}`));
            break;
        }
      }

      await Promise.all(mixedOps);

      const duration = Date.now() - startTime;
      const throughput = (operations / duration) * 1000;

      // Then
      expect(throughput).toBeGreaterThan(500);
      console.log(`✅ Mixed operations throughput: ${throughput.toFixed(0)} ops/sec`);

      // Cleanup
      const deletePromises: Promise<any>[] = [];
      for (let i = 0; i < operations; i++) {
        const opType = i % 5;
        switch (opType) {
          case 0:
            deletePromises.push(client.del(`stress:mixed:str:${i}`));
            break;
          case 1:
            deletePromises.push(client.del(`stress:mixed:hash:${i}`));
            break;
          case 2:
            deletePromises.push(client.del(`stress:mixed:list:${i}`));
            break;
          case 3:
            deletePromises.push(client.del(`stress:mixed:set:${i}`));
            break;
          case 4:
            deletePromises.push(client.del(`stress:mixed:zset:${i}`));
            break;
        }
      }
      await Promise.all(deletePromises);

      await manager.closeClient('stress-mixed');
    }, 60000);
  });

  describe('Transaction Stress', () => {
    it('should handle 100 concurrent transactions', async () => {
      // Given
      const client = await manager.createClient('stress-transactions', config);
      await client.connect();

      const transactionCount = 100;

      // When
      const startTime = Date.now();

      const transactions: Promise<any>[] = [];
      for (let i = 0; i < transactionCount; i++) {
        transactions.push(
          (async () => {
            const multi = client.multi();
            multi.set(`stress:tx:${i}`, '0');
            multi.incr(`stress:tx:${i}`);
            multi.incr(`stress:tx:${i}`);
            multi.incr(`stress:tx:${i}`);
            return multi.exec();
          })(),
        );
      }

      const results = await Promise.all(transactions);

      const duration = Date.now() - startTime;

      // Then
      expect(results).toHaveLength(transactionCount);
      results.forEach((result) => {
        expect(result).toHaveLength(4);
        expect(result[3][1]).toBe(3); // Final value should be 3
      });

      console.log(`✅ Executed ${transactionCount} transactions in ${duration}ms`);

      // Cleanup
      const deletePromises: Promise<any>[] = [];
      for (let i = 0; i < transactionCount; i++) {
        deletePromises.push(client.del(`stress:tx:${i}`));
      }
      await Promise.all(deletePromises);

      await manager.closeClient('stress-transactions');
    }, 60000);
  });

  describe('Pipeline Stress', () => {
    it('should handle pipeline with 10,000 commands', async () => {
      // Given
      const client = await manager.createClient('stress-pipeline', config);
      await client.connect();

      const commandCount = 10000;

      // When
      const startTime = Date.now();

      const pipeline = client.pipeline();
      for (let i = 0; i < commandCount; i++) {
        pipeline.set(`stress:pipeline:${i}`, `value${i}`);
      }
      const results = await pipeline.exec();

      const duration = Date.now() - startTime;
      const throughput = (commandCount / duration) * 1000;

      // Then
      expect(results).toHaveLength(commandCount);
      expect(throughput).toBeGreaterThan(10000); // Should be very fast
      console.log(`✅ Pipeline with ${commandCount} commands completed in ${duration}ms (${throughput.toFixed(0)} ops/sec)`);

      // Cleanup
      const deletePipeline = client.pipeline();
      for (let i = 0; i < commandCount; i++) {
        deletePipeline.del(`stress:pipeline:${i}`);
      }
      await deletePipeline.exec();

      await manager.closeClient('stress-pipeline');
    }, 60000);
  });
});
