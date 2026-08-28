import { describe, it, expect } from 'vitest';
import { ErrorCode } from '@nestjs-redisx/core';
import { LeaderError, InvalidLeaderConfigError, LeaderStoreError } from '../../src/shared/errors';

describe('Leader Errors', () => {
  describe('InvalidLeaderConfigError', () => {
    it('should carry the dedicated config code and extend LeaderError', () => {
      // When
      const error = new InvalidLeaderConfigError('"ttlMs" must be a positive integer');

      // Then
      expect(error).toBeInstanceOf(InvalidLeaderConfigError);
      expect(error).toBeInstanceOf(LeaderError);
      expect(error.code).toBe(ErrorCode.LEADER_CONFIG_INVALID);
      expect(error.message).toContain('ttlMs');
    });

    it('should serialize via toJSON like every RedisXError', () => {
      // When
      const json = new InvalidLeaderConfigError('bad config').toJSON();

      // Then
      expect(json).toMatchObject({
        name: 'InvalidLeaderConfigError',
        code: ErrorCode.LEADER_CONFIG_INVALID,
        message: 'bad config',
      });
    });
  });

  describe('LeaderStoreError', () => {
    it('should carry the store code and the cause', () => {
      // Given
      const cause = new Error('connection lost');

      // When
      const error = new LeaderStoreError('Failed to read leader', cause);

      // Then
      expect(error).toBeInstanceOf(LeaderStoreError);
      expect(error).toBeInstanceOf(LeaderError);
      expect(error.code).toBe(ErrorCode.LEADER_STORE_ERROR);
      expect(error.cause).toBe(cause);
    });
  });
});
