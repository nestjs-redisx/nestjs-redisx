import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import type { IRedisDriver } from '@nestjs-redisx/core';
import { RedisIdempotencyStoreAdapter } from '../../src/idempotency/infrastructure/adapters/redis-idempotency-store.adapter';
import type { IIdempotencyRecord } from '../../src/shared/types';

describe('RedisIdempotencyStoreAdapter', () => {
  let adapter: RedisIdempotencyStoreAdapter;
  let mockDriver: MockedObject<IRedisDriver>;

  beforeEach(() => {
    mockDriver = {
      scriptLoad: vi.fn().mockResolvedValue('sha1hash'),
      evalsha: vi.fn(),
      hmset: vi.fn().mockResolvedValue('OK'),
      hgetall: vi.fn(),
      expire: vi.fn().mockResolvedValue(1),
      del: vi.fn().mockResolvedValue(1),
    } as unknown as MockedObject<IRedisDriver>;

    adapter = new RedisIdempotencyStoreAdapter(mockDriver);
  });

  describe('onModuleInit', () => {
    it('should load Lua script on initialization', async () => {
      // Given
      mockDriver.scriptLoad.mockResolvedValue('sha123456');

      // When
      await adapter.onModuleInit();

      // Then
      expect(mockDriver.scriptLoad).toHaveBeenCalledWith(expect.stringContaining('redis.call'));
    });
  });

  describe('checkAndLock', () => {
    beforeEach(async () => {
      await adapter.onModuleInit();
    });

    it('should return new status for new request', async () => {
      // Given
      const key = 'test-key';
      const fingerprint = 'fp123';
      const lockTimeout = 30000;
      mockDriver.evalsha.mockResolvedValue(['new']);

      // When
      const result = await adapter.checkAndLock(key, fingerprint, lockTimeout);

      // Then
      expect(result).toEqual({ status: 'new' });
      expect(mockDriver.evalsha).toHaveBeenCalledWith('sha1hash', [key], [fingerprint, lockTimeout, expect.any(Number)]);
    });

    it('should return fingerprint_mismatch status when fingerprint differs', async () => {
      // Given
      const key = 'test-key';
      const fingerprint = 'different-fp';
      mockDriver.evalsha.mockResolvedValue(['fingerprint_mismatch']);

      // When
      const result = await adapter.checkAndLock(key, fingerprint, 30000);

      // Then
      expect(result).toEqual({ status: 'fingerprint_mismatch' });
    });

    it('should return processing status when request is in progress', async () => {
      // Given
      const key = 'test-key';
      const fingerprint = 'fp123';
      mockDriver.evalsha.mockResolvedValue(['processing']);

      // When
      const result = await adapter.checkAndLock(key, fingerprint, 30000);

      // Then
      expect(result).toEqual({ status: 'processing' });
    });

    it('should return completed status with record', async () => {
      // Given
      const key = 'test-key';
      const fingerprint = 'fp123';
      mockDriver.evalsha.mockResolvedValue(['completed', '200', '{"data":"test"}', '{"Content-Type":"application/json"}', '']);

      // When
      const result = await adapter.checkAndLock(key, fingerprint, 30000);

      // Then
      expect(result.status).toBe('completed');
      expect(result.record).toMatchObject({
        key,
        fingerprint,
        status: 'completed',
        statusCode: 200,
        response: '{"data":"test"}',
        headers: '{"Content-Type":"application/json"}',
      });
    });

    it('should return failed status with error', async () => {
      // Given
      const key = 'test-key';
      const fingerprint = 'fp123';
      mockDriver.evalsha.mockResolvedValue(['failed', '', '', '', 'Database connection error']);

      // When
      const result = await adapter.checkAndLock(key, fingerprint, 30000);

      // Then
      expect(result.status).toBe('failed');
      expect(result.record).toMatchObject({
        key,
        fingerprint,
        status: 'failed',
        error: 'Database connection error',
      });
    });

    it('should handle empty optional fields', async () => {
      // Given
      const key = 'test-key';
      const fingerprint = 'fp123';
      mockDriver.evalsha.mockResolvedValue(['completed', '', '', '', '']);

      // When
      const result = await adapter.checkAndLock(key, fingerprint, 30000);

      // Then
      expect(result.status).toBe('completed');
      expect(result.record?.statusCode).toBeUndefined();
      expect(result.record?.response).toBeUndefined();
      expect(result.record?.headers).toBeUndefined();
      expect(result.record?.error).toBeUndefined();
    });
  });

  describe('complete', () => {
    it('should store completed data with TTL', async () => {
      // Given
      const key = 'test-key';
      const data = {
        statusCode: 201,
        response: '{"id":123}',
        headers: '{"Content-Type":"application/json"}',
        completedAt: Date.now(),
      };
      const ttl = 3600;

      // When
      await adapter.complete(key, data, ttl);

      // Then
      expect(mockDriver.hmset).toHaveBeenCalledWith(key, {
        status: 'completed',
        statusCode: '201',
        response: '{"id":123}',
        headers: '{"Content-Type":"application/json"}',
        completedAt: String(data.completedAt),
      });
      expect(mockDriver.expire).toHaveBeenCalledWith(key, ttl);
    });

    it('should handle missing optional fields', async () => {
      // Given
      const key = 'test-key';
      const data = {
        statusCode: 200,
        response: '{}',
        completedAt: Date.now(),
      };
      const ttl = 86400;

      // When
      await adapter.complete(key, data, ttl);

      // Then
      expect(mockDriver.hmset).toHaveBeenCalledWith(key, {
        status: 'completed',
        statusCode: '200',
        response: '{}',
        headers: '',
        completedAt: String(data.completedAt),
      });
    });
  });

  describe('fail', () => {
    it('should store failed status with error message', async () => {
      // Given
      const key = 'test-key';
      const error = 'Internal server error';

      // When
      await adapter.fail(key, error);

      // Then
      expect(mockDriver.hmset).toHaveBeenCalledWith(key, {
        status: 'failed',
        error,
        completedAt: expect.any(String),
      });
    });
  });

  describe('get', () => {
    it('should return idempotency record when exists', async () => {
      // Given
      const key = 'test-key';
      const data = {
        fingerprint: 'fp123',
        status: 'completed',
        statusCode: '200',
        response: '{"data":"test"}',
        headers: '{"Content-Type":"application/json"}',
        startedAt: '1234567890',
        completedAt: '1234567900',
      };
      mockDriver.hgetall.mockResolvedValue(data);

      // When
      const result = await adapter.get(key);

      // Then
      expect(result).toMatchObject({
        key,
        fingerprint: 'fp123',
        status: 'completed',
        statusCode: 200,
        response: '{"data":"test"}',
        headers: '{"Content-Type":"application/json"}',
        startedAt: 1234567890,
        completedAt: 1234567900,
      });
    });

    it('should return processing record', async () => {
      // Given
      const key = 'test-key';
      const data = {
        fingerprint: 'fp456',
        status: 'processing',
        startedAt: '1234567890',
      };
      mockDriver.hgetall.mockResolvedValue(data);

      // When
      const result = await adapter.get(key);

      // Then
      expect(result).toMatchObject({
        key,
        fingerprint: 'fp456',
        status: 'processing',
        startedAt: 1234567890,
      });
    });

    it('should return failed record', async () => {
      // Given
      const key = 'test-key';
      const data = {
        fingerprint: 'fp789',
        status: 'failed',
        error: 'Database error',
        startedAt: '1234567890',
        completedAt: '1234567900',
      };
      mockDriver.hgetall.mockResolvedValue(data);

      // When
      const result = await adapter.get(key);

      // Then
      expect(result).toMatchObject({
        key,
        fingerprint: 'fp789',
        status: 'failed',
        error: 'Database error',
        startedAt: 1234567890,
        completedAt: 1234567900,
      });
    });

    it('should return null when record does not exist', async () => {
      // Given
      const key = 'missing-key';
      mockDriver.hgetall.mockResolvedValue(null);

      // When
      const result = await adapter.get(key);

      // Then
      expect(result).toBeNull();
    });

    it('should return null when record is empty', async () => {
      // Given
      const key = 'empty-key';
      mockDriver.hgetall.mockResolvedValue({});

      // When
      const result = await adapter.get(key);

      // Then
      expect(result).toBeNull();
    });

    it('should handle missing optional fields', async () => {
      // Given
      const key = 'test-key';
      const data = {
        fingerprint: 'fp123',
        status: 'completed',
        startedAt: '1234567890',
      };
      mockDriver.hgetall.mockResolvedValue(data);

      // When
      const result = await adapter.get(key);

      // Then
      expect(result?.statusCode).toBeUndefined();
      expect(result?.response).toBeUndefined();
      expect(result?.headers).toBeUndefined();
      expect(result?.completedAt).toBeUndefined();
      expect(result?.error).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('should delete record and return true', async () => {
      // Given
      const key = 'test-key';
      mockDriver.del.mockResolvedValue(1);

      // When
      const result = await adapter.delete(key);

      // Then
      expect(result).toBe(true);
      expect(mockDriver.del).toHaveBeenCalledWith(key);
    });

    it('should return false when record does not exist', async () => {
      // Given
      const key = 'missing-key';
      mockDriver.del.mockResolvedValue(0);

      // When
      const result = await adapter.delete(key);

      // Then
      expect(result).toBe(false);
    });
  });
});
