import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import type { IRedisDriver } from '@nestjs-redisx/core';
import { DeadLetterService } from '../../src/streams/application/services/dead-letter.service';
import type { IStreamsPluginOptions } from '../../src/shared/types';

describe('DeadLetterService', () => {
  let service: DeadLetterService;
  let mockDriver: MockedObject<IRedisDriver>;
  let config: IStreamsPluginOptions;

  beforeEach(() => {
    mockDriver = {
      xadd: vi.fn(),
      xrange: vi.fn(),
      xdel: vi.fn(),
      del: vi.fn(),
    } as unknown as MockedObject<IRedisDriver>;

    config = {
      dlq: {
        enabled: true,
        streamSuffix: ':dlq',
        maxLen: 10000,
      },
    };

    service = new DeadLetterService(mockDriver, config);
  });

  describe('add', () => {
    it('should add message to DLQ', async () => {
      // Given
      const stream = 'orders';
      const originalId = '1234567890-0';
      const data = { orderId: 123 };
      const error = new Error('Processing failed');
      mockDriver.xadd.mockResolvedValue('1234567891-0');

      // When
      const dlqId = await service.add(stream, originalId, data, error);

      // Then
      expect(dlqId).toBe('1234567891-0');
      expect(mockDriver.xadd).toHaveBeenCalledWith(
        'orders:dlq',
        '*',
        expect.objectContaining({
          data: JSON.stringify(data),
          originalId,
          originalStream: stream,
          error: 'Processing failed',
        }),
        { maxLen: 10000, approximate: true },
      );
    });

    it('should add message without error object', async () => {
      // Given
      const stream = 'events';
      const originalId = '1234567890-1';
      const data = { event: 'test' };
      mockDriver.xadd.mockResolvedValue('1234567891-1');

      // When
      await service.add(stream, originalId, data);

      // Then
      expect(mockDriver.xadd).toHaveBeenCalledWith(
        'events:dlq',
        '*',
        expect.objectContaining({
          error: 'Unknown error',
        }),
        expect.any(Object),
      );
    });

    it('should return empty string when DLQ is disabled', async () => {
      // Given
      config.dlq!.enabled = false;
      service = new DeadLetterService(mockDriver, config);

      // When
      const result = await service.add('test', '123', {});

      // Then
      expect(result).toBe('');
      expect(mockDriver.xadd).not.toHaveBeenCalled();
    });

    it('should use custom DLQ suffix', async () => {
      // Given
      config.dlq!.streamSuffix = ':failed';
      service = new DeadLetterService(mockDriver, config);
      mockDriver.xadd.mockResolvedValue('123-0');

      // When
      await service.add('orders', '123', {});

      // Then
      expect(mockDriver.xadd).toHaveBeenCalledWith('orders:failed', expect.any(String), expect.any(Object), expect.any(Object));
    });

    it('should use custom maxLen', async () => {
      // Given
      config.dlq!.maxLen = 5000;
      service = new DeadLetterService(mockDriver, config);
      mockDriver.xadd.mockResolvedValue('123-0');

      // When
      await service.add('orders', '123', {});

      // Then
      expect(mockDriver.xadd).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.any(Object), { maxLen: 5000, approximate: true });
    });

    it('should include failedAt timestamp', async () => {
      // Given
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      mockDriver.xadd.mockResolvedValue('123-0');

      // When
      await service.add('orders', '123', {});

      // Then
      expect(mockDriver.xadd).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          failedAt: now.toString(),
        }),
        expect.any(Object),
      );
    });
  });

  describe('getMessages', () => {
    it('should retrieve DLQ messages', async () => {
      // Given
      const stream = 'orders';
      const now = Date.now();
      mockDriver.xrange.mockResolvedValue([
        {
          id: '1234567890-0',
          fields: {
            data: JSON.stringify({ orderId: 123 }),
            originalId: '1234567880-0',
            originalStream: 'orders',
            error: 'Processing failed',
            failedAt: now.toString(),
          },
        },
        {
          id: '1234567891-0',
          fields: {
            data: JSON.stringify({ orderId: 456 }),
            originalId: '1234567881-0',
            originalStream: 'orders',
            error: 'Timeout',
            failedAt: (now + 1000).toString(),
          },
        },
      ]);

      // When
      const messages = await service.getMessages(stream);

      // Then
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({
        id: '1234567890-0',
        data: { orderId: 123 },
        originalId: '1234567880-0',
        originalStream: 'orders',
        error: 'Processing failed',
      });
      expect(messages[0]!.failedAt).toBeInstanceOf(Date);
      expect(mockDriver.xrange).toHaveBeenCalledWith('orders:dlq', '-', '+', { count: 100 });
    });

    it('should retrieve with custom count', async () => {
      // Given
      const stream = 'events';
      mockDriver.xrange.mockResolvedValue([]);

      // When
      await service.getMessages(stream, 50);

      // Then
      expect(mockDriver.xrange).toHaveBeenCalledWith('events:dlq', '-', '+', { count: 50 });
    });

    it('should use custom DLQ suffix', async () => {
      // Given
      config.dlq!.streamSuffix = ':failed';
      service = new DeadLetterService(mockDriver, config);
      mockDriver.xrange.mockResolvedValue([]);

      // When
      await service.getMessages('orders');

      // Then
      expect(mockDriver.xrange).toHaveBeenCalledWith('orders:failed', '-', '+', { count: 100 });
    });

    it('should return empty array when no messages', async () => {
      // Given
      mockDriver.xrange.mockResolvedValue([]);

      // When
      const messages = await service.getMessages('empty');

      // Then
      expect(messages).toEqual([]);
    });
  });

  describe('requeue', () => {
    it('should requeue message from DLQ', async () => {
      // Given
      const stream = 'orders';
      const dlqMessageId = '1234567890-0';
      const data = { orderId: 123 };
      mockDriver.xrange.mockResolvedValue([
        {
          id: dlqMessageId,
          fields: {
            data: JSON.stringify(data),
            originalId: '1234567880-0',
            originalStream: stream,
            error: 'Processing failed',
            failedAt: Date.now().toString(),
          },
        },
      ]);
      mockDriver.xadd.mockResolvedValue('1234567900-0');
      mockDriver.xdel.mockResolvedValue(1);

      // When
      const newId = await service.requeue(dlqMessageId, stream);

      // Then
      expect(newId).toBe('1234567900-0');
      expect(mockDriver.xadd).toHaveBeenCalledWith(stream, '*', {
        data: JSON.stringify(data),
        _attempt: '1',
      });
      expect(mockDriver.xdel).toHaveBeenCalledWith('orders:dlq', dlqMessageId);
    });

    it('should throw error when message not found', async () => {
      // Given
      const dlqMessageId = 'missing-id';
      mockDriver.xrange.mockResolvedValue([]);

      // When/Then
      await expect(service.requeue(dlqMessageId, 'orders')).rejects.toThrow('not found');
    });

    it('should use custom DLQ suffix when requeueing', async () => {
      // Given
      config.dlq!.streamSuffix = ':failed';
      service = new DeadLetterService(mockDriver, config);
      const dlqMessageId = '123-0';
      mockDriver.xrange.mockResolvedValue([{ id: dlqMessageId, fields: { data: '{}' } }]);
      mockDriver.xadd.mockResolvedValue('456-0');
      mockDriver.xdel.mockResolvedValue(1);

      // When
      await service.requeue(dlqMessageId, 'orders');

      // Then
      expect(mockDriver.xrange).toHaveBeenCalledWith('orders:failed', dlqMessageId, dlqMessageId);
      expect(mockDriver.xdel).toHaveBeenCalledWith('orders:failed', dlqMessageId);
    });
  });

  describe('purge', () => {
    it('should purge DLQ stream', async () => {
      // Given
      const stream = 'orders';
      mockDriver.del.mockResolvedValue(1);

      // When
      const deleted = await service.purge(stream);

      // Then
      expect(deleted).toBe(1);
      expect(mockDriver.del).toHaveBeenCalledWith('orders:dlq');
    });

    it('should use custom DLQ suffix when purging', async () => {
      // Given
      config.dlq!.streamSuffix = ':failed';
      service = new DeadLetterService(mockDriver, config);
      mockDriver.del.mockResolvedValue(1);

      // When
      await service.purge('orders');

      // Then
      expect(mockDriver.del).toHaveBeenCalledWith('orders:failed');
    });

    it('should return 0 when DLQ stream does not exist', async () => {
      // Given
      mockDriver.del.mockResolvedValue(0);

      // When
      const deleted = await service.purge('nonexistent');

      // Then
      expect(deleted).toBe(0);
    });
  });
});
