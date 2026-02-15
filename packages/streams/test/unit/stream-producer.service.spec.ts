import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import type { IRedisDriver } from '@nestjs-redisx/core';
import { StreamProducerService } from '../../src/streams/application/services/stream-producer.service';
import type { IStreamsPluginOptions } from '../../src/shared/types';
import { StreamPublishError } from '../../src/shared/errors';

describe('StreamProducerService', () => {
  let service: StreamProducerService;
  let mockDriver: MockedObject<IRedisDriver>;
  let config: IStreamsPluginOptions;

  beforeEach(() => {
    mockDriver = {
      xadd: vi.fn(),
      xinfo: vi.fn(),
      xtrim: vi.fn(),
    } as unknown as MockedObject<IRedisDriver>;

    config = {
      keyPrefix: 'stream:',
      producer: {
        maxLen: 100000,
        autoCreate: true,
      },
    };

    service = new StreamProducerService(mockDriver, config);
  });

  describe('publish', () => {
    it('should publish message to stream', async () => {
      // Given
      const stream = 'orders';
      const data = { orderId: 123, amount: 99.99 };
      mockDriver.xadd.mockResolvedValue('1234567890-0');

      // When
      const messageId = await service.publish(stream, data);

      // Then
      expect(messageId).toBe('1234567890-0');
      expect(mockDriver.xadd).toHaveBeenCalledWith(stream, '*', { data: JSON.stringify(data) }, { maxLen: 100000, approximate: true });
    });

    it('should publish with custom maxLen from options', async () => {
      // Given
      const stream = 'events';
      const data = { event: 'user.login' };
      mockDriver.xadd.mockResolvedValue('1234567890-1');

      // When
      await service.publish(stream, data, { maxLen: 50000 });

      // Then
      expect(mockDriver.xadd).toHaveBeenCalledWith(stream, '*', { data: JSON.stringify(data) }, { maxLen: 50000, approximate: true });
    });

    it('should publish with custom ID', async () => {
      // Given
      const stream = 'logs';
      const data = { message: 'test' };
      const customId = '1234567890-0';
      mockDriver.xadd.mockResolvedValue(customId);

      // When
      await service.publish(stream, data, { id: customId });

      // Then
      expect(mockDriver.xadd).toHaveBeenCalledWith(stream, customId, { data: JSON.stringify(data) }, expect.any(Object));
    });

    it('should use default maxLen when not configured', async () => {
      // Given
      const serviceWithoutConfig = new StreamProducerService(mockDriver, {});
      const stream = 'test';
      const data = { test: 'data' };
      mockDriver.xadd.mockResolvedValue('1234567890-0');

      // When
      await serviceWithoutConfig.publish(stream, data);

      // Then
      expect(mockDriver.xadd).toHaveBeenCalledWith(stream, '*', { data: JSON.stringify(data) }, { maxLen: 100000, approximate: true });
    });

    it('should throw StreamPublishError on failure', async () => {
      // Given
      const stream = 'orders';
      const data = { test: 'data' };
      const error = new Error('Redis connection lost');
      mockDriver.xadd.mockRejectedValue(error);

      // When/Then
      try {
        await service.publish(stream, data);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect((err as Error).name).toMatch(/StreamPublishError/);
        expect((err as StreamPublishError).stream).toBe(stream);
      }
    });
  });

  describe('publishBatch', () => {
    it('should publish multiple messages', async () => {
      // Given
      const stream = 'orders';
      const messages = [
        { orderId: 1, amount: 10 },
        { orderId: 2, amount: 20 },
        { orderId: 3, amount: 30 },
      ];
      mockDriver.xadd.mockResolvedValueOnce('1234567890-0').mockResolvedValueOnce('1234567890-1').mockResolvedValueOnce('1234567890-2');

      // When
      const messageIds = await service.publishBatch(stream, messages);

      // Then
      expect(messageIds).toEqual(['1234567890-0', '1234567890-1', '1234567890-2']);
      expect(mockDriver.xadd).toHaveBeenCalledTimes(3);
      expect(mockDriver.xadd).toHaveBeenNthCalledWith(1, stream, '*', { data: JSON.stringify(messages[0]) }, { maxLen: 100000, approximate: true });
    });

    it('should publish batch with custom maxLen', async () => {
      // Given
      const stream = 'events';
      const messages = [{ event: 'test1' }, { event: 'test2' }];
      mockDriver.xadd.mockResolvedValueOnce('1234567890-0').mockResolvedValueOnce('1234567890-1');

      // When
      await service.publishBatch(stream, messages, { maxLen: 50000 });

      // Then
      expect(mockDriver.xadd).toHaveBeenCalledWith(stream, '*', expect.any(Object), { maxLen: 50000, approximate: true });
    });

    it('should handle empty batch', async () => {
      // Given
      const stream = 'test';
      const messages: any[] = [];

      // When
      const messageIds = await service.publishBatch(stream, messages);

      // Then
      expect(messageIds).toEqual([]);
      expect(mockDriver.xadd).not.toHaveBeenCalled();
    });

    it('should throw StreamPublishError on batch failure', async () => {
      // Given
      const stream = 'orders';
      const messages = [{ test: 'data' }];
      const error = new Error('Connection error');
      mockDriver.xadd.mockRejectedValue(error);

      // When/Then
      try {
        await service.publishBatch(stream, messages);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect((err as Error).name).toMatch(/StreamPublishError/);
      }
    });
  });

  describe('getStreamInfo', () => {
    it('should return stream info with entries', async () => {
      // Given
      const stream = 'orders';
      const info = {
        length: 100,
        firstEntry: { id: '1234567890-0', fields: { data: 'test' } },
        lastEntry: { id: '1234567999-0', fields: { data: 'test' } },
        groups: 2,
        lastGeneratedId: '1234567999-0',
        radixTreeKeys: 1,
        radixTreeNodes: 2,
      };
      mockDriver.xinfo.mockResolvedValue(info);

      // When
      const result = await service.getStreamInfo(stream);

      // Then
      expect(result.length).toBe(100);
      expect(result.firstEntry?.id).toBe('1234567890-0');
      expect(result.firstEntry?.timestamp).toBeInstanceOf(Date);
      expect(result.lastEntry?.id).toBe('1234567999-0');
      expect(result.groups).toBe(2);
      expect(mockDriver.xinfo).toHaveBeenCalledWith(stream);
    });

    it('should handle stream with no entries', async () => {
      // Given
      const stream = 'empty';
      const info = {
        length: 0,
        firstEntry: null,
        lastEntry: null,
        groups: 0,
        lastGeneratedId: '0-0',
        radixTreeKeys: 0,
        radixTreeNodes: 0,
      };
      mockDriver.xinfo.mockResolvedValue(info);

      // When
      const result = await service.getStreamInfo(stream);

      // Then
      expect(result.length).toBe(0);
      expect(result.firstEntry).toBeUndefined();
      expect(result.lastEntry).toBeUndefined();
      expect(result.groups).toBe(0);
    });

    it('should return empty info when stream does not exist', async () => {
      // Given
      const stream = 'nonexistent';
      mockDriver.xinfo.mockRejectedValue(new Error('ERR no such key'));

      // When
      const result = await service.getStreamInfo(stream);

      // Then
      expect(result.length).toBe(0);
      expect(result.groups).toBe(0);
      expect(result.firstEntry).toBeUndefined();
      expect(result.lastEntry).toBeUndefined();
    });
  });

  describe('trim', () => {
    it('should trim stream to maxLen', async () => {
      // Given
      const stream = 'logs';
      const maxLen = 1000;
      mockDriver.xtrim.mockResolvedValue(50);

      // When
      const trimmed = await service.trim(stream, maxLen);

      // Then
      expect(trimmed).toBe(50);
      expect(mockDriver.xtrim).toHaveBeenCalledWith(stream, maxLen, true);
    });

    it('should trim with different maxLen values', async () => {
      // Given
      const stream = 'events';
      mockDriver.xtrim.mockResolvedValue(100);

      // When
      await service.trim(stream, 5000);

      // Then
      expect(mockDriver.xtrim).toHaveBeenCalledWith(stream, 5000, true);
    });
  });
});
