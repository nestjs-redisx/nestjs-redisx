/**
 * Serializer interface for cache value serialization.
 * Defines how values are converted to/from storage format.
 */

export interface ISerializer {
  /**
   * Serializes a value to string or Buffer.
   *
   * @param value - Value to serialize
   * @returns Serialized data
   * @throws Error if serialization fails
   */
  serialize<T>(value: T): string | Buffer;

  /**
   * Deserializes data back to original value.
   *
   * @param data - Serialized data
   * @returns Deserialized value
   * @throws Error if deserialization fails
   */
  deserialize<T>(data: string | Buffer): T;

  /**
   * Safely tries to deserialize, returns null on error.
   *
   * @param data - Serialized data
   * @returns Deserialized value or null
   */
  tryDeserialize<T>(data: string | Buffer): T | null;

  /**
   * Gets the content type identifier for this serializer.
   *
   * @returns Content type string (e.g., 'application/json', 'application/msgpack')
   */
  getContentType(): string;
}
