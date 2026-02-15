/**
 * Cache serializers for different data formats.
 *
 * @example
 * ```typescript
 * import { JsonSerializer, MsgpackSerializer } from '@nestjs-redisx/cache';
 *
 * const jsonSerializer = new JsonSerializer();
 * const serialized = jsonSerializer.serialize({ id: 1, name: 'John' });
 *
 * // For better performance and smaller size, use MessagePack
 * const msgpackSerializer = new MsgpackSerializer();
 * const binary = msgpackSerializer.serialize(largeData);
 * ```
 */

export type { ISerializer } from './serializer.interface';
export { JsonSerializer } from './json.serializer';
export { MsgpackSerializer } from './msgpack.serializer';
