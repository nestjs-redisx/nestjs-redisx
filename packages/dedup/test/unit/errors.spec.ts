import { describe, it, expect } from 'vitest';
import { RedisXError, ErrorCode } from '@nestjs-redisx/core';
import { DedupError, InvalidDedupConfigError, DedupStoreError } from '../../src/shared/errors';

describe('dedup errors', () => {
  it('should build the hierarchy on RedisXError with dedup codes', () => {
    // Given/When
    const config = new InvalidDedupConfigError('bad');
    const storeError = new DedupStoreError('k', new Error('down'));

    // Then
    expect(config).toBeInstanceOf(DedupError);
    expect(config).toBeInstanceOf(RedisXError);
    expect(storeError).toBeInstanceOf(DedupError);
    expect(config.code).toBe(ErrorCode.DEDUP_CONFIG_INVALID);
    expect(storeError.code).toBe(ErrorCode.DEDUP_STORE_ERROR);
  });

  it('should carry the key and cause on store errors', () => {
    // Given
    const cause = new Error('socket reset');

    // When
    const error = new DedupStoreError('webhook:1', cause);

    // Then
    expect(error.dedupKey).toBe('webhook:1');
    expect(error.message).toContain('webhook:1');
    expect(error.cause).toBe(cause);
  });

  it('should serialize via toJSON with code and context', () => {
    // When
    const json = new DedupStoreError('k').toJSON() as Record<string, unknown>;

    // Then
    expect(json.code).toBe(ErrorCode.DEDUP_STORE_ERROR);
    expect((json.context as Record<string, unknown>).dedupKey).toBe('k');
  });
});
