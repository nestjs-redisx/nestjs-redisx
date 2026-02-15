import { describe, it, expect, beforeEach, vi, type MockedObject } from 'vitest';
import { IdempotencyService } from '../../src/idempotency/application/services/idempotency.service';
import type { IIdempotencyStore } from '../../src/idempotency/application/ports/idempotency-store.port';
import type { IIdempotencyPluginOptions, IIdempotencyRecord } from '../../src/shared/types';

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let mockStore: MockedObject<IIdempotencyStore>;
  let config: IIdempotencyPluginOptions;

  beforeEach(() => {
    mockStore = {
      checkAndLock: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
    } as unknown as MockedObject<IIdempotencyStore>;

    config = {
      keyPrefix: 'idempotency:',
      defaultTtl: 86400,
      lockTimeout: 30000,
      waitTimeout: 60000,
    };

    service = new IdempotencyService(config, mockStore);
  });

  describe('checkAndLock', () => {
    it('should return isNew for new request', async () => {
      // Given
      mockStore.checkAndLock.mockResolvedValue({ status: 'new' });

      // When
      const result = await service.checkAndLock('key1', 'fp1');

      // Then
      expect(result.isNew).toBe(true);
      expect(mockStore.checkAndLock).toHaveBeenCalledWith('idempotency:key1', 'fp1', 30000);
    });

    it('should return fingerprintMismatch on mismatch', async () => {
      // Given
      mockStore.checkAndLock.mockResolvedValue({ status: 'fingerprint_mismatch' });

      // When
      const result = await service.checkAndLock('key2', 'fp2');

      // Then
      expect(result.fingerprintMismatch).toBe(true);
    });

    it('should return record on completed request', async () => {
      // Given
      const record: IIdempotencyRecord = {
        status: 'completed',
        fingerprint: 'fp3',
        statusCode: 200,
        response: '{"data":"test"}',
        createdAt: Date.now(),
        completedAt: Date.now(),
      };
      mockStore.checkAndLock.mockResolvedValue({ status: 'completed', record });

      // When
      const result = await service.checkAndLock('key3', 'fp3');

      // Then
      expect(result.isNew).toBe(false);
      expect(result.record).toEqual(record);
    });

    it('should wait for processing request', async () => {
      // Given
      const completedRecord: IIdempotencyRecord = {
        status: 'completed',
        fingerprint: 'fp4',
        statusCode: 200,
        response: '{}',
        createdAt: Date.now(),
        completedAt: Date.now(),
      };
      mockStore.checkAndLock.mockResolvedValue({ status: 'processing' });
      mockStore.get.mockResolvedValue(completedRecord);

      // When
      const result = await service.checkAndLock('key4', 'fp4');

      // Then
      expect(result.isNew).toBe(false);
      expect(result.record).toEqual(completedRecord);
    });

    it('should wait for processing request and return failed record', async () => {
      // Given
      const failedRecord: IIdempotencyRecord = {
        status: 'failed',
        fingerprint: 'fp5',
        error: 'Processing error',
        createdAt: Date.now(),
        completedAt: Date.now(),
      };
      mockStore.checkAndLock.mockResolvedValue({ status: 'processing' });
      mockStore.get.mockResolvedValue(failedRecord);

      // When
      const result = await service.checkAndLock('key5', 'fp5');

      // Then
      expect(result.isNew).toBe(false);
      expect(result.record).toEqual(failedRecord);
    });

    it('should throw timeout error when waiting too long', async () => {
      // Given
      const processingRecord: IIdempotencyRecord = {
        status: 'processing',
        fingerprint: 'fp6',
        createdAt: Date.now(),
      };
      mockStore.checkAndLock.mockResolvedValue({ status: 'processing' });
      mockStore.get.mockResolvedValue(processingRecord);
      config.waitTimeout = 200; // Short timeout for testing
      service = new IdempotencyService(config, mockStore);

      // When/Then
      try {
        await service.checkAndLock('key6', 'fp6');
        expect.fail('Should have thrown timeout error');
      } catch (error) {
        expect((error as Error).name).toMatch(/IdempotencyTimeoutError/);
      }
    });

    it('should throw error when record not found during wait', async () => {
      // Given
      mockStore.checkAndLock.mockResolvedValue({ status: 'processing' });
      mockStore.get.mockResolvedValue(null);

      // When/Then
      try {
        await service.checkAndLock('key7', 'fp7');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).name).toMatch(/IdempotencyRecordNotFoundError/);
      }
    });
  });

  describe('complete', () => {
    it('should complete idempotency record', async () => {
      // Given
      const response = { statusCode: 201, body: { id: 123 } };

      // When
      await service.complete('key5', response);

      // Then
      expect(mockStore.complete).toHaveBeenCalledWith(
        'idempotency:key5',
        expect.objectContaining({
          statusCode: 201,
          response: '{"id":123}',
        }),
        86400,
      );
    });

    it('should use custom TTL', async () => {
      // Given
      const response = { statusCode: 200, body: {} };

      // When
      await service.complete('key6', response, { ttl: 3600 });

      // Then
      expect(mockStore.complete).toHaveBeenCalledWith(expect.any(String), expect.any(Object), 3600);
    });

    it('should complete with headers', async () => {
      // Given
      const response = {
        statusCode: 200,
        body: { data: 'test' },
        headers: { 'Content-Type': 'application/json' },
      };

      // When
      await service.complete('key7', response);

      // Then
      expect(mockStore.complete).toHaveBeenCalledWith(
        'idempotency:key7',
        expect.objectContaining({
          statusCode: 200,
          response: '{"data":"test"}',
          headers: '{"Content-Type":"application/json"}',
        }),
        86400,
      );
    });
  });

  describe('fail', () => {
    it('should mark record as failed', async () => {
      // Given
      const error = 'Database error';

      // When
      await service.fail('key7', error);

      // Then
      expect(mockStore.fail).toHaveBeenCalledWith('idempotency:key7', error);
    });
  });

  describe('get', () => {
    it('should get idempotency record', async () => {
      // Given
      const record: IIdempotencyRecord = {
        status: 'completed',
        fingerprint: 'fp',
        statusCode: 200,
        response: '{}',
        createdAt: Date.now(),
        completedAt: Date.now(),
      };
      mockStore.get.mockResolvedValue(record);

      // When
      const result = await service.get('key8');

      // Then
      expect(result).toEqual(record);
      expect(mockStore.get).toHaveBeenCalledWith('idempotency:key8');
    });

    it('should return null when not found', async () => {
      // Given
      mockStore.get.mockResolvedValue(null);

      // When
      const result = await service.get('missing');

      // Then
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete idempotency record', async () => {
      // Given
      mockStore.delete.mockResolvedValue(true);

      // When
      const result = await service.delete('key9');

      // Then
      expect(result).toBe(true);
      expect(mockStore.delete).toHaveBeenCalledWith('idempotency:key9');
    });
  });

  describe('key building', () => {
    it('should use configured prefix', async () => {
      // Given
      mockStore.checkAndLock.mockResolvedValue({ status: 'new' });

      // When
      await service.checkAndLock('test', 'fp');

      // Then
      expect(mockStore.checkAndLock).toHaveBeenCalledWith('idempotency:test', expect.any(String), expect.any(Number));
    });
  });
});
