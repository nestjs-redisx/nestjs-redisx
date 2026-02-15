import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RedisClientManager } from '../../src/client/application/redis-client.manager';
import { ConnectionConfig } from '../../src/types';

/**
 * Redis Client Manager Load Tests
 *
 * Prerequisites:
 * 1. Start Redis: npm run docker:redis:up
 * 2. Run tests: npm run test:load
 *
 * Performance Benchmarks:
 * - Throughput: > 10,000 ops/sec for simple operations
 * - Latency: < 2ms p95 for local Redis
 * - Connection pool: Handle 100+ concurrent clients
 */
describe('Redis Client Manager Load Tests', () => {
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
    client = await manager.createClient('load-test', config);
    await client.connect();
  });

  afterAll(async () => {
    if (manager) {
      await manager.closeAll();
    }
  });

  describe('Throughput Tests', () => {
    it('should handle 10,000 SET operations', async () => {
      // Given
      const operations = 10000;
      const startTime = Date.now();

      // When
      const promises: Promise<any>[] = [];
      for (let i = 0; i < operations; i++) {
        promises.push(client.set(`load:throughput:${i}`, `value${i}`));
      }
      await Promise.all(promises);

      const duration = Date.now() - startTime;
      const throughput = (operations / duration) * 1000;

      // Then
      expect(throughput).toBeGreaterThan(5000); // At least 5k ops/sec
      console.log(`✅ Throughput: ${throughput.toFixed(0)} ops/sec`);

      // Cleanup
      const deletePromises: Promise<any>[] = [];
      for (let i = 0; i < operations; i++) {
        deletePromises.push(client.del(`load:throughput:${i}`));
      }
      await Promise.all(deletePromises);
    }, 30000);

    it('should handle 5,000 GET operations', async () => {
      // Given
      const operations = 5000;
      const setupPromises: Promise<any>[] = [];
      for (let i = 0; i < operations; i++) {
        setupPromises.push(client.set(`load:get:${i}`, `value${i}`));
      }
      await Promise.all(setupPromises);

      const startTime = Date.now();

      // When
      const getPromises: Promise<any>[] = [];
      for (let i = 0; i < operations; i++) {
        getPromises.push(client.get(`load:get:${i}`));
      }
      const results = await Promise.all(getPromises);

      const duration = Date.now() - startTime;
      const throughput = (operations / duration) * 1000;

      // Then
      expect(results).toHaveLength(operations);
      expect(throughput).toBeGreaterThan(5000);
      console.log(`✅ GET Throughput: ${throughput.toFixed(0)} ops/sec`);

      // Cleanup
      const deletePromises: Promise<any>[] = [];
      for (let i = 0; i < operations; i++) {
        deletePromises.push(client.del(`load:get:${i}`));
      }
      await Promise.all(deletePromises);
    }, 30000);
  });

  describe('Latency Tests', () => {
    it('should measure latency distribution for 1,000 operations', async () => {
      // Given
      const operations = 1000;
      const latencies: number[] = [];

      // When
      for (let i = 0; i < operations; i++) {
        const start = performance.now();
        await client.set(`load:latency:${i}`, `value${i}`);
        const end = performance.now();
        latencies.push(end - start);
      }

      // Calculate percentiles
      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(operations * 0.5)];
      const p95 = latencies[Math.floor(operations * 0.95)];
      const p99 = latencies[Math.floor(operations * 0.99)];
      const avg = latencies.reduce((sum, lat) => sum + lat, 0) / operations;

      // Then
      expect(p50).toBeLessThan(5); // p50 < 5ms
      expect(p95).toBeLessThan(10); // p95 < 10ms
      expect(p99).toBeLessThan(20); // p99 < 20ms

      console.log(`✅ Latency - Avg: ${avg.toFixed(2)}ms, p50: ${p50.toFixed(2)}ms, p95: ${p95.toFixed(2)}ms, p99: ${p99.toFixed(2)}ms`);

      // Cleanup
      const deletePromises: Promise<any>[] = [];
      for (let i = 0; i < operations; i++) {
        deletePromises.push(client.del(`load:latency:${i}`));
      }
      await Promise.all(deletePromises);
    }, 30000);
  });

  describe('Concurrent Operations', () => {
    it('should handle 100 concurrent clients performing operations', async () => {
      // Given
      const concurrency = 100;
      const opsPerClient = 50;
      const clients: any[] = [];

      // Create clients
      for (let i = 0; i < concurrency; i++) {
        const c = await manager.createClient(`load-concurrent-${i}`, config);
        await c.connect();
        clients.push(c);
      }

      const startTime = Date.now();

      // When - each client performs operations
      const clientPromises = clients.map(async (c, clientIndex) => {
        const ops: Promise<any>[] = [];
        for (let i = 0; i < opsPerClient; i++) {
          ops.push(c.set(`load:concurrent:${clientIndex}:${i}`, `value${i}`));
        }
        return Promise.all(ops);
      });

      await Promise.all(clientPromises);

      const duration = Date.now() - startTime;
      const totalOps = concurrency * opsPerClient;
      const throughput = (totalOps / duration) * 1000;

      // Then
      expect(throughput).toBeGreaterThan(2000);
      console.log(`✅ Concurrent Throughput: ${throughput.toFixed(0)} ops/sec (${concurrency} clients)`);

      // Cleanup
      for (let i = 0; i < concurrency; i++) {
        await manager.closeClient(`load-concurrent-${i}`);
      }

      const deletePromises: Promise<any>[] = [];
      for (let clientIndex = 0; clientIndex < concurrency; clientIndex++) {
        for (let i = 0; i < opsPerClient; i++) {
          deletePromises.push(client.del(`load:concurrent:${clientIndex}:${i}`));
        }
      }
      await Promise.all(deletePromises);
    }, 60000);
  });

  describe('Pipeline Performance', () => {
    it('should demonstrate pipeline efficiency vs sequential', async () => {
      // Given
      const operations = 1000;

      // Sequential operations
      const sequentialStart = Date.now();
      for (let i = 0; i < operations; i++) {
        await client.set(`load:seq:${i}`, `value${i}`);
      }
      const sequentialDuration = Date.now() - sequentialStart;

      // Cleanup
      const deleteSeqPromises: Promise<any>[] = [];
      for (let i = 0; i < operations; i++) {
        deleteSeqPromises.push(client.del(`load:seq:${i}`));
      }
      await Promise.all(deleteSeqPromises);

      // Pipeline operations
      const pipelineStart = Date.now();
      const pipeline = client.pipeline();
      for (let i = 0; i < operations; i++) {
        pipeline.set(`load:pipe:${i}`, `value${i}`);
      }
      await pipeline.exec();
      const pipelineDuration = Date.now() - pipelineStart;

      // Then
      const speedup = sequentialDuration / pipelineDuration;
      expect(speedup).toBeGreaterThan(5); // Pipeline should be at least 5x faster

      console.log(`✅ Pipeline Speedup: ${speedup.toFixed(1)}x (Sequential: ${sequentialDuration}ms, Pipeline: ${pipelineDuration}ms)`);

      // Cleanup
      const deletePipePromises: Promise<any>[] = [];
      for (let i = 0; i < operations; i++) {
        deletePipePromises.push(client.del(`load:pipe:${i}`));
      }
      await Promise.all(deletePipePromises);
    }, 60000);
  });

  describe('Data Structure Performance', () => {
    it('should handle bulk hash operations efficiently', async () => {
      // Given
      const hashCount = 100;
      const fieldsPerHash = 100;
      const startTime = Date.now();

      // When
      const pipeline = client.pipeline();
      for (let h = 0; h < hashCount; h++) {
        const fields: Record<string, string> = {};
        for (let f = 0; f < fieldsPerHash; f++) {
          fields[`field${f}`] = `value${f}`;
        }
        pipeline.hmset(`load:hash:${h}`, fields);
      }
      await pipeline.exec();

      const duration = Date.now() - startTime;
      const totalFields = hashCount * fieldsPerHash;
      const throughput = (totalFields / duration) * 1000;

      // Then
      expect(throughput).toBeGreaterThan(1000);
      console.log(`✅ Hash Throughput: ${throughput.toFixed(0)} fields/sec`);

      // Cleanup
      const deletePromises: Promise<any>[] = [];
      for (let h = 0; h < hashCount; h++) {
        deletePromises.push(client.del(`load:hash:${h}`));
      }
      await Promise.all(deletePromises);
    }, 30000);

    it('should handle bulk list operations efficiently', async () => {
      // Given
      const listCount = 50;
      const itemsPerList = 200;
      const startTime = Date.now();

      // When
      const pipeline = client.pipeline();
      for (let l = 0; l < listCount; l++) {
        const items = Array.from({ length: itemsPerList }, (_, i) => `item${i}`);
        pipeline.rpush(`load:list:${l}`, ...items);
      }
      await pipeline.exec();

      const duration = Date.now() - startTime;
      const totalItems = listCount * itemsPerList;
      const throughput = (totalItems / duration) * 1000;

      // Then
      expect(throughput).toBeGreaterThan(1000);
      console.log(`✅ List Throughput: ${throughput.toFixed(0)} items/sec`);

      // Cleanup
      const deletePromises: Promise<any>[] = [];
      for (let l = 0; l < listCount; l++) {
        deletePromises.push(client.del(`load:list:${l}`));
      }
      await Promise.all(deletePromises);
    }, 30000);
  });

  describe('Memory Efficiency', () => {
    it('should handle large value operations', async () => {
      // Given
      const largeValue = 'x'.repeat(1024 * 10); // 10KB
      const count = 100;
      const startTime = Date.now();

      // When
      const promises: Promise<any>[] = [];
      for (let i = 0; i < count; i++) {
        promises.push(client.set(`load:large:${i}`, largeValue));
      }
      await Promise.all(promises);

      const duration = Date.now() - startTime;
      const totalMB = (count * largeValue.length) / (1024 * 1024);
      const throughputMBps = totalMB / (duration / 1000);

      // Then
      expect(throughputMBps).toBeGreaterThan(1); // At least 1 MB/s
      console.log(`✅ Large Value Throughput: ${throughputMBps.toFixed(2)} MB/s`);

      // Cleanup
      const deletePromises: Promise<any>[] = [];
      for (let i = 0; i < count; i++) {
        deletePromises.push(client.del(`load:large:${i}`));
      }
      await Promise.all(deletePromises);
    }, 30000);
  });
});
