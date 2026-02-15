import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import type { IRedisDriver } from '@nestjs-redisx/core';
import { StreamConsumerService } from '../../src/streams/application/services/stream-consumer.service';
import type { IStreamsPluginOptions } from '../../src/shared/types';
import type { IDeadLetterService } from '../../src/streams/application/ports/dead-letter.port';

// Mock ConsumerInstance
vi.mock('../../src/streams/application/services/consumer-instance', () => ({
  ConsumerInstance: vi.fn().mockImplementation(function () {
    return {
      start: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

describe('StreamConsumerService', () => {
  let service: StreamConsumerService;
  let mockDriver: MockedObject<IRedisDriver>;
  let mockDlqService: MockedObject<IDeadLetterService>;
  let config: IStreamsPluginOptions;

  beforeEach(() => {
    mockDriver = {
      xgroupCreate: vi.fn(),
      xpending: vi.fn(),
      xpendingRange: vi.fn(),
      xclaim: vi.fn(),
      xack: vi.fn(),
    } as unknown as MockedObject<IRedisDriver>;

    mockDlqService = {
      add: vi.fn(),
      getMessages: vi.fn(),
      requeue: vi.fn(),
      purge: vi.fn(),
    } as unknown as MockedObject<IDeadLetterService>;

    config = {
      consumer: {
        batchSize: 10,
        blockTimeout: 5000,
        maxRetries: 3,
        concurrency: 1,
      },
    };

    service = new StreamConsumerService(mockDriver, config, mockDlqService);
  });

  describe('consume', () => {
    it('should create consumer and return handle', () => {
      // Given
      const stream = 'orders';
      const group = 'processors';
      const consumer = 'worker-1';
      const handler = vi.fn();

      // When
      const handle = service.consume(stream, group, consumer, handler);

      // Then
      expect(handle).toMatchObject({
        id: 'orders:processors:worker-1',
        isRunning: true,
      });
    });

    it('should use custom options', () => {
      // Given
      const handler = vi.fn();
      const options = {
        batchSize: 20,
        blockTimeout: 10000,
        maxRetries: 5,
        concurrency: 3,
        startId: '0',
      };

      // When
      const handle = service.consume('events', 'workers', 'w1', handler, options);

      // Then
      expect(handle.id).toBe('events:workers:w1');
    });

    it('should use default config values', () => {
      // Given
      const handler = vi.fn();

      // When
      const handle = service.consume('logs', 'readers', 'r1', handler);

      // Then
      expect(handle.isRunning).toBe(true);
    });

    it('should throw error when consumer already exists', () => {
      // Given
      const stream = 'orders';
      const group = 'processors';
      const consumer = 'worker-1';
      const handler = vi.fn();
      service.consume(stream, group, consumer, handler);

      // When/Then
      expect(() => {
        service.consume(stream, group, consumer, handler);
      }).toThrow('already exists');
    });

    it('should allow different consumers with same stream and group', () => {
      // Given
      const stream = 'orders';
      const group = 'processors';
      const handler = vi.fn();

      // When
      const handle1 = service.consume(stream, group, 'worker-1', handler);
      const handle2 = service.consume(stream, group, 'worker-2', handler);

      // Then
      expect(handle1.id).not.toBe(handle2.id);
    });
  });

  describe('stop', () => {
    it('should stop consumer by handle', async () => {
      // Given
      const handler = vi.fn();
      const handle = service.consume('orders', 'processors', 'worker-1', handler);

      // When
      await service.stop(handle);

      // Then - consumer should be removed (can recreate with same ID)
      const newHandle = service.consume('orders', 'processors', 'worker-1', handler);
      expect(newHandle.id).toBe(handle.id);
    });

    it('should do nothing when stopping non-existent consumer', async () => {
      // Given
      const handle = { id: 'nonexistent', isRunning: true };

      // When/Then - should not throw
      await expect(service.stop(handle)).resolves.not.toThrow();
    });
  });

  describe('createGroup', () => {
    it('should create consumer group', async () => {
      // Given
      const stream = 'orders';
      const group = 'processors';
      mockDriver.xgroupCreate.mockResolvedValue('OK');

      // When
      await service.createGroup(stream, group);

      // Then
      expect(mockDriver.xgroupCreate).toHaveBeenCalledWith(stream, group, '0', true);
    });

    it('should create group with custom start ID', async () => {
      // Given
      const stream = 'events';
      const group = 'listeners';
      const startId = '$';
      mockDriver.xgroupCreate.mockResolvedValue('OK');

      // When
      await service.createGroup(stream, group, startId);

      // Then
      expect(mockDriver.xgroupCreate).toHaveBeenCalledWith(stream, group, startId, true);
    });

    it('should ignore BUSYGROUP error', async () => {
      // Given
      const error = new Error('BUSYGROUP Consumer Group name already exists');
      mockDriver.xgroupCreate.mockRejectedValue(error);

      // When/Then - should not throw
      await expect(service.createGroup('orders', 'processors')).resolves.not.toThrow();
    });

    it('should throw other errors', async () => {
      // Given
      const error = new Error('Connection lost');
      mockDriver.xgroupCreate.mockRejectedValue(error);

      // When/Then
      await expect(service.createGroup('orders', 'processors')).rejects.toThrow('Connection lost');
    });
  });

  describe('getPending', () => {
    it('should return pending info', async () => {
      // Given
      const stream = 'orders';
      const group = 'processors';
      mockDriver.xpending.mockResolvedValue({
        count: 5,
        minId: '1234567890-0',
        maxId: '1234567895-0',
        consumers: [
          { name: 'worker-1', count: 3 },
          { name: 'worker-2', count: 2 },
        ],
      });

      // When
      const result = await service.getPending(stream, group);

      // Then
      expect(result).toEqual({
        count: 5,
        minId: '1234567890-0',
        maxId: '1234567895-0',
        consumers: [
          { name: 'worker-1', pending: 3 },
          { name: 'worker-2', pending: 2 },
        ],
      });
    });

    it('should handle no pending messages', async () => {
      // Given
      mockDriver.xpending.mockResolvedValue({
        count: 0,
        minId: null,
        maxId: null,
        consumers: [],
      });

      // When
      const result = await service.getPending('empty', 'group');

      // Then
      expect(result).toEqual({
        count: 0,
        minId: '',
        maxId: '',
        consumers: [],
      });
    });
  });

  describe('claimIdle', () => {
    it('should return empty array when no idle messages', async () => {
      // Given
      mockDriver.xpendingRange.mockResolvedValue([]);

      // When
      const result = await service.claimIdle('orders', 'processors', 'worker-1', 30000);

      // Then
      expect(result).toEqual([]);
      expect(mockDriver.xpendingRange).toHaveBeenCalledWith('orders', 'processors', '-', '+', 100);
    });

    it('should claim idle messages via xclaim', async () => {
      // Given
      mockDriver.xpendingRange.mockResolvedValue([
        { id: '1-0', consumer: 'worker-old', idleTime: 60000, deliveryCount: 2 },
        { id: '2-0', consumer: 'worker-old', idleTime: 45000, deliveryCount: 1 },
        { id: '3-0', consumer: 'worker-old', idleTime: 10000, deliveryCount: 1 },
      ]);
      mockDriver.xclaim.mockResolvedValue([
        { id: '1-0', fields: { data: '{"orderId":1}', _attempt: '2' } },
        { id: '2-0', fields: { data: '{"orderId":2}', _attempt: '1' } },
      ]);

      // When
      const result = await service.claimIdle('orders', 'processors', 'worker-1', 30000);

      // Then
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('1-0');
      expect(result[0]!.data).toEqual({ orderId: 1 });
      expect(result[1]!.id).toBe('2-0');
      expect(mockDriver.xclaim).toHaveBeenCalledWith('orders', 'processors', 'worker-1', 30000, '1-0', '2-0');
    });

    it('should filter by minIdleTime', async () => {
      // Given
      mockDriver.xpendingRange.mockResolvedValue([{ id: '1-0', consumer: 'worker-old', idleTime: 5000, deliveryCount: 1 }]);

      // When
      const result = await service.claimIdle('orders', 'processors', 'worker-1', 30000);

      // Then
      expect(result).toEqual([]);
      expect(mockDriver.xclaim).not.toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should stop all consumers on module destroy', async () => {
      // Given
      const handler = vi.fn();
      const handle1 = service.consume('orders', 'processors', 'worker-1', handler);
      const handle2 = service.consume('events', 'listeners', 'listener-1', handler);

      // When
      await service.onModuleDestroy();

      // Then - consumers should be stopped and removed
      await service.stop(handle1); // Should not throw (already removed)
      await service.stop(handle2); // Should not throw (already removed)
    });

    it('should handle empty consumers map', async () => {
      // Given - no consumers

      // When/Then - should not throw
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });
  });
});
