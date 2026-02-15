/**
 * JSON serializer for cache values.
 *
 * Uses native JSON.stringify/parse for serialization.
 * Best for human-readable data and compatibility.
 *
 * @example
 * ```typescript
 * const serializer = new JsonSerializer();
 *
 * const data = { id: 1, name: 'John' };
 * const serialized = serializer.serialize(data);
 * // '{"id":1,"name":"John"}'
 *
 * const deserialized = serializer.deserialize<User>(serialized);
 * // { id: 1, name: 'John' }
 * ```
 */

import { ISerializer } from './serializer.interface';
import { SerializationError } from '../shared/errors';

export class JsonSerializer implements ISerializer {
  /**
   * Serializes value to JSON string.
   *
   * @param value - Value to serialize
   * @returns JSON string
   * @throws SerializationError if serialization fails
   */
  serialize<T>(value: T): string {
    try {
      return JSON.stringify(value);
    } catch (error) {
      throw new SerializationError(`JSON serialization failed: ${(error as Error).message}`, error as Error);
    }
  }

  /**
   * Deserializes JSON string back to value.
   *
   * @param data - JSON string or buffer
   * @returns Deserialized value
   * @throws SerializationError if deserialization fails
   */
  deserialize<T>(data: string | Buffer): T {
    try {
      const str = Buffer.isBuffer(data) ? data.toString('utf8') : data;
      return JSON.parse(str) as T;
    } catch (error) {
      throw new SerializationError(`JSON deserialization failed: ${(error as Error).message}`, error as Error);
    }
  }

  /**
   * Safely tries to deserialize, returns null on error.
   *
   * @param data - JSON string or buffer
   * @returns Deserialized value or null
   */
  tryDeserialize<T>(data: string | Buffer): T | null {
    try {
      return this.deserialize<T>(data);
    } catch {
      return null;
    }
  }

  /**
   * Gets content type for JSON.
   *
   * @returns Content type string
   */
  getContentType(): string {
    return 'application/json';
  }
}
