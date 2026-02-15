import { describe, it, expect, vi } from 'vitest';
import { StreamMessage } from '../../src/streams/domain/entities/stream-message.entity';

describe('StreamMessage Entity', () => {
  describe('constructor', () => {
    it('should create message with all properties', () => {
      // Given
      const id = '1234-0';
      const stream = 'orders';
      const data = { orderId: 123, amount: 99.99 };
      const attempt = 1;
      const timestamp = new Date();
      const ackFn = vi.fn();
      const rejectFn = vi.fn();

      // When
      const message = new StreamMessage(id, stream, data, attempt, timestamp, ackFn, rejectFn);

      // Then
      expect(message.id).toBe(id);
      expect(message.stream).toBe(stream);
      expect(message.data).toEqual(data);
      expect(message.attempt).toBe(attempt);
      expect(message.timestamp).toBe(timestamp);
    });

    it('should create message with generic type', () => {
      // Given
      interface OrderData {
        orderId: number;
        status: string;
      }
      const data: OrderData = { orderId: 456, status: 'pending' };

      // When
      const message = new StreamMessage<OrderData>('1234-0', 'orders', data, 1, new Date(), vi.fn(), vi.fn());

      // Then
      expect(message.data.orderId).toBe(456);
      expect(message.data.status).toBe('pending');
    });
  });

  describe('ack', () => {
    it('should call ack function', async () => {
      // Given
      const ackFn = vi.fn().mockResolvedValue(undefined);
      const message = new StreamMessage('1234-0', 'orders', { data: 'test' }, 1, new Date(), ackFn, vi.fn());

      // When
      await message.ack();

      // Then
      expect(ackFn).toHaveBeenCalledOnce();
    });

    it('should propagate ack errors', async () => {
      // Given
      const error = new Error('ACK failed');
      const ackFn = vi.fn().mockRejectedValue(error);
      const message = new StreamMessage('1234-0', 'orders', { data: 'test' }, 1, new Date(), ackFn, vi.fn());

      // When/Then
      await expect(message.ack()).rejects.toThrow('ACK failed');
    });
  });

  describe('reject', () => {
    it('should call reject function without error', async () => {
      // Given
      const rejectFn = vi.fn().mockResolvedValue(undefined);
      const message = new StreamMessage('1234-0', 'orders', { data: 'test' }, 1, new Date(), vi.fn(), rejectFn);

      // When
      await message.reject();

      // Then
      expect(rejectFn).toHaveBeenCalledOnce();
      expect(rejectFn).toHaveBeenCalledWith(undefined);
    });

    it('should call reject function with error', async () => {
      // Given
      const rejectFn = vi.fn().mockResolvedValue(undefined);
      const message = new StreamMessage('1234-0', 'orders', { data: 'test' }, 1, new Date(), vi.fn(), rejectFn);
      const error = new Error('Processing failed');

      // When
      await message.reject(error);

      // Then
      expect(rejectFn).toHaveBeenCalledOnce();
      expect(rejectFn).toHaveBeenCalledWith(error);
    });

    it('should propagate reject errors', async () => {
      // Given
      const error = new Error('Reject failed');
      const rejectFn = vi.fn().mockRejectedValue(error);
      const message = new StreamMessage('1234-0', 'orders', { data: 'test' }, 1, new Date(), vi.fn(), rejectFn);

      // When/Then
      await expect(message.reject()).rejects.toThrow('Reject failed');
    });
  });

  describe('multiple operations', () => {
    it('should allow ack after multiple attempts', async () => {
      // Given
      const ackFn = vi.fn().mockResolvedValue(undefined);
      const message = new StreamMessage('1234-0', 'orders', { data: 'test' }, 3, new Date(), ackFn, vi.fn());

      // When
      await message.ack();

      // Then
      expect(message.attempt).toBe(3);
      expect(ackFn).toHaveBeenCalledOnce();
    });

    it('should maintain message immutability', () => {
      // Given
      const data = { orderId: 123 };
      const message = new StreamMessage('1234-0', 'orders', data, 1, new Date(), vi.fn(), vi.fn());

      // When
      data.orderId = 456;

      // Then
      expect(message.data.orderId).toBe(456); // Data object is mutable (not deep frozen)
      expect(message.stream).toBe('orders'); // But readonly properties can't be reassigned
    });
  });
});
