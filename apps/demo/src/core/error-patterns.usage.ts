import { Injectable } from '@nestjs/common';
import {
  RedisService,
  RedisXError,
  RedisConnectionError,
  RedisOperationError,
  RedisTimeoutError,
  ErrorCode,
  isErrorDomain,
} from '@nestjs-redisx/core';

@Injectable()
export class ErrorPatternsService {
  constructor(private readonly redis: RedisService) {}

  // Pattern 1: Catch by error class
  async catchByClass(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch (error) {
      if (error instanceof RedisConnectionError) {
        // Connection issue — retry or fallback
      } else if (error instanceof RedisOperationError) {
        // Command issue — log and rethrow
      }
      throw error;
    }
  }

  // Pattern 2: Catch by error code
  async catchByCode(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch (error) {
      if (RedisXError.isRedisXError(error)) {
        switch (error.code) {
          case ErrorCode.CONN_TIMEOUT:
            // Handle timeout
            break;
          case ErrorCode.OP_NOT_CONNECTED:
            // Handle disconnection
            break;
          default:
            throw error;
        }
      }
      return null;
    }
  }

  // Pattern 3: Catch by domain
  async catchByDomain(key: string, value: string): Promise<void> {
    try {
      await this.redis.set(key, value);
    } catch (error) {
      if (RedisXError.isRedisXError(error)) {
        if (isErrorDomain(error.code, 'CONN')) {
          // Any connection error
        } else if (isErrorDomain(error.code, 'OP')) {
          // Any operation error
        }
      }
    }
  }

  // Pattern 4: Wrap unknown errors
  async wrapUnknown(): Promise<void> {
    try {
      await this.externalOperation();
    } catch (error) {
      throw RedisXError.wrap(error, ErrorCode.OP_FAILED);
    }
  }

  private async externalOperation(): Promise<void> {
    // External call
  }
}
