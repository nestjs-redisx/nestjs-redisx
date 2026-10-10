/**
 * MessagePack serializer for cache values.
 *
 * Uses msgpackr for binary serialization.
 * More compact and faster than JSON, but requires msgpackr package.
 *
 * Install: npm install msgpackr
 *
 * @example
 * ```typescript
 * const serializer = new MsgpackSerializer();
 *
 * const data = { id: 1, name: 'John', tags: ['user', 'active'] };
 * const serialized = serializer.serialize(data);
 * // Buffer<...> (binary data, ~40% smaller than JSON)
 *
 * const deserialized = serializer.deserialize<User>(serialized);
 * // { id: 1, name: 'John', tags: ['user', 'active'] }
 * ```
 */

import { createRequire } from 'node:module';

import { ISerializer } from './serializer.interface';
import { SerializationError } from '../shared/errors';

/**
 * Loads the optional `msgpackr` dependency lazily AND synchronously in both
 * bundles. A bare `require()` here compiles to a throwing stand-in in the ESM
 * bundle ("Dynamic require of msgpackr is not supported"), which made the
 * constructor report "msgpackr package is required" even with the package
 * installed. `createRequire(__filename)` resolves exactly like a regular
 * require next to this file - `__filename` is native in the CJS bundle and
 * polyfilled from `import.meta.url` by the tsup `shims` option in ESM
 * (`import.meta` itself is rejected by this codebase's CommonJS `module`
 * setting at typecheck).
 */
const requireOptional = createRequire(__filename);

/**
 * Msgpackr encoder interface.
 */
interface IMsgpackEncoder {
  encode(value: unknown): Buffer;
}

/**
 * Msgpackr decoder interface.
 */
interface IMsgpackDecoder {
  decode(buffer: Buffer): unknown;
}

export class MsgpackSerializer implements ISerializer {
  private encoder: IMsgpackEncoder;
  private decoder: IMsgpackDecoder;

  constructor() {
    try {
      // Lazy load msgpackr to make it optional
      const msgpackr = requireOptional('msgpackr');
      this.encoder = new msgpackr.Encoder({
        useRecords: false, // Don't use msgpack extension records
        structuredClone: true, // Deep clone objects
      });
      this.decoder = new msgpackr.Decoder({
        useRecords: false,
      });
    } catch {
      throw new Error('msgpackr package is required for MsgpackSerializer. Install with: npm install msgpackr');
    }
  }

  /**
   * Serializes value to MessagePack buffer.
   *
   * @param value - Value to serialize
   * @returns MessagePack buffer
   * @throws SerializationError if serialization fails
   */
  serialize<T>(value: T): Buffer {
    try {
      return this.encoder.encode(value);
    } catch (error) {
      throw new SerializationError(`MessagePack serialization failed: ${(error as Error).message}`, error as Error);
    }
  }

  /**
   * Deserializes MessagePack buffer back to value.
   *
   * @param data - MessagePack buffer or string
   * @returns Deserialized value
   * @throws SerializationError if deserialization fails
   */
  deserialize<T>(data: string | Buffer): T {
    try {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'binary');
      return this.decoder.decode(buffer) as T;
    } catch (error) {
      throw new SerializationError(`MessagePack deserialization failed: ${(error as Error).message}`, error as Error);
    }
  }

  /**
   * Safely tries to deserialize, returns null on error.
   *
   * @param data - MessagePack buffer or string
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
   * Gets content type for MessagePack.
   *
   * @returns Content type string
   */
  getContentType(): string {
    return 'application/msgpack';
  }

  /**
   * Compares serialized size with JSON.
   *
   * @param value - Value to compare
   * @returns Object with sizes and compression ratio
   */
  compareWithJson<T>(value: T): {
    jsonSize: number;
    msgpackSize: number;
    compressionRatio: number;
  } {
    const jsonSize = Buffer.from(JSON.stringify(value), 'utf8').length;
    const msgpackSize = this.serialize(value).length;

    return {
      jsonSize,
      msgpackSize,
      compressionRatio: jsonSize / msgpackSize,
    };
  }
}
