/**
 * Serializer service for cache values.
 */

import { Injectable } from '@nestjs/common';

import { SerializationError } from '../../../shared/errors';

@Injectable()
export class Serializer {
  /**
   * Serializes value to string.
   *
   * @param value - Value to serialize
   * @returns Serialized string
   * @throws SerializationError if serialization fails
   */
  serialize<T>(value: T): string {
    try {
      return JSON.stringify(value);
    } catch (error) {
      throw new SerializationError(`Failed to serialize value: ${(error as Error).message}`, error as Error);
    }
  }

  /**
   * Deserializes string to value.
   *
   * @param serialized - Serialized string
   * @returns Deserialized value
   * @throws SerializationError if deserialization fails
   */
  deserialize<T>(serialized: string): T {
    try {
      return JSON.parse(serialized) as T;
    } catch (error) {
      throw new SerializationError(`Failed to deserialize value: ${(error as Error).message}`, error as Error);
    }
  }

  /**
   * Safely tries to deserialize, returns null on error.
   *
   * @param serialized - Serialized string
   * @returns Deserialized value or null
   */
  tryDeserialize<T>(serialized: string): T | null {
    try {
      return this.deserialize<T>(serialized);
    } catch {
      return null;
    }
  }
}
