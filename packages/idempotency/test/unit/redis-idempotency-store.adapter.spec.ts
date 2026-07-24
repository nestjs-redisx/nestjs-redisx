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
      expect(mockDriver.evalsha).toHaveBeenCalledWith('sha1hash', [key], [fingerprint, lockTimeout, expect.any(Number), '1']);
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
      await adapter.fail(key, error, 30);

      // Then
      expect(mockDriver.hmset).toHaveBeenCalledWith(key, {
        status: 'failed',
        error,
        completedAt: expect.any(String),
      });
    });

    it('should set an expiry on the failed record', async () => {
      // Given
      const key = 'test-key';

      // When
      await adapter.fail(key, 'boom', 30);

      // Then - the failed record expires instead of relying on the lock TTL
      expect(mockDriver.expire).toHaveBeenCalledWith(key, 30);
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

  describe('fingerprint persistence (rewrites after lock expiry)', () => {
    it('complete() should persist the fingerprint when provided', async () => {
      // Given / When
      await adapter.complete('idempotency:k1', { fingerprint: 'fp-1', statusCode: 201, response: '{"id":1}', completedAt: 123 }, 3600);

      // Then — HMSET includes the fingerprint so a record re-created after
      // lock expiry still matches future replays (no spurious 422)
      expect(mockDriver.hmset).toHaveBeenCalledWith('idempotency:k1', expect.objectContaining({ status: 'completed', fingerprint: 'fp-1' }));
    });

    it('fail() should persist the fingerprint when provided', async () => {
      // Given / When
      await adapter.fail('idempotency:k2', 'boom', 30, 'fp-2');

      // Then
      expect(mockDriver.hmset).toHaveBeenCalledWith('idempotency:k2', expect.objectContaining({ status: 'failed', fingerprint: 'fp-2' }));
    });

    it('get() should tolerate records without fingerprint/startedAt (legacy rewrites)', async () => {
      // Given — a record re-created by a pre-fix complete() after expiry
      mockDriver.hgetall.mockResolvedValue({ status: 'completed', statusCode: '200', response: '"ok"', completedAt: '5' });

      // When
      const record = await adapter.get('idempotency:k3');

      // Then — no crash, sane defaults
      expect(record).toMatchObject({ status: 'completed', fingerprint: '', startedAt: 0 });
    });
  });

  describe('validateFingerprint flag', () => {
    it("should pass '1' to Lua by default and '0' when disabled", async () => {
      // Given
      mockDriver.evalsha.mockResolvedValue(['new']);
      await adapter.onModuleInit();

      // When
      await adapter.checkAndLock('idempotency:k', 'fp', 30000);
      await adapter.checkAndLock('idempotency:k', 'fp', 30000, false);

      // Then
      expect(mockDriver.evalsha.mock.calls[0][2][3]).toBe('1');
      expect(mockDriver.evalsha.mock.calls[1][2][3]).toBe('0');
    });
  });
});
