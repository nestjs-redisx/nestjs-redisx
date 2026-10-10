import { describe, it, expect } from 'vitest';
import { RedisXError, ErrorCode } from '@nestjs-redisx/core';
import { SemaphoreError, SemaphoreAcquisitionError, SemaphorePermitNotHeldError, SemaphoreExtensionError, InvalidSemaphoreConfigError } from '../../src/shared/errors';

describe('semaphore errors', () => {
  it('should build the full hierarchy on RedisXError with semaphore codes', () => {
    // Given/When
    const acquisitionTimeout = new SemaphoreAcquisitionError('renders', 'timeout');
    const acquisitionFailed = new SemaphoreAcquisitionError('renders', 'exhausted', new Error('boom'));
    const notHeld = new SemaphorePermitNotHeldError('renders', 'permit-1');
    const extension = new SemaphoreExtensionError('renders', 'permit-1');
    const config = new InvalidSemaphoreConfigError('bad config');

    // Then
    for (const error of [acquisitionTimeout, acquisitionFailed, notHeld, extension]) {
      expect(error).toBeInstanceOf(SemaphoreError);
      expect(error).toBeInstanceOf(RedisXError);
    }
    expect(config).toBeInstanceOf(RedisXError);

    expect(acquisitionTimeout.code).toBe(ErrorCode.SEMAPHORE_ACQUISITION_TIMEOUT);
    expect(acquisitionFailed.code).toBe(ErrorCode.SEMAPHORE_ACQUISITION_FAILED);
    expect(notHeld.code).toBe(ErrorCode.SEMAPHORE_PERMIT_NOT_HELD);
    expect(extension.code).toBe(ErrorCode.SEMAPHORE_EXTENSION_FAILED);
    expect(config.code).toBe(ErrorCode.SEMAPHORE_CONFIG_INVALID);
  });

  it('should carry the semaphore key and reason in messages and context', () => {
    // Given/When
    const error = new SemaphoreAcquisitionError('reports:render', 'exhausted');

    // Then
    expect(error.message).toContain('reports:render');
    expect(error.message).toContain('exhausted');
    expect(error.semaphoreKey).toBe('reports:render');
    expect(error.reason).toBe('exhausted');
  });

  it('should serialize permit ids via toJSON', () => {
    // Given/When
    const notHeld = new SemaphorePermitNotHeldError('k', 'permit-42').toJSON() as Record<string, unknown>;
    const extension = new SemaphoreExtensionError('k', 'permit-42').toJSON() as Record<string, unknown>;

    // Then
    expect(notHeld.permitId).toBe('permit-42');
    expect(extension.permitId).toBe('permit-42');
    expect(notHeld.code).toBe(ErrorCode.SEMAPHORE_PERMIT_NOT_HELD);
  });

  it('should preserve the cause chain', () => {
    // Given
    const cause = new Error('socket reset');

    // When
    const error = new SemaphoreExtensionError('k', 'p', cause);

    // Then
    expect(error.cause).toBe(cause);
  });
});
