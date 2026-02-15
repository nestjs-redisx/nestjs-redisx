---
title: Serializers
description: Data serialization options for cache storage
---

# Serializers

How data is serialized for storage in Redis (L2 cache).

::: info L2 only
Serialization applies only to **L2 (Redis)**. L1 (memory) stores JavaScript objects directly — no serialization overhead.
:::

## Default Behavior

The cache plugin uses **JSON serialization** internally via the `Serializer` domain service. This is hardcoded in the plugin — there is no `serializer` option in `CachePlugin` config.

```typescript
// This is what the plugin registers internally
{ provide: SERIALIZER, useClass: Serializer }  // JSON-only, not configurable
```

All `set()`, `get()`, `getOrSet()`, and SWR operations use `JSON.stringify()` / `JSON.parse()` for L2 storage.

## Available Serializers

The package exports serializer classes implementing the `ISerializer` interface. These are **standalone utilities** — they can be used independently or as a replacement for the internal serializer via manual provider override.

| Serializer | Output | Types Supported | Best For |
|------------|--------|-----------------|----------|
| **JsonSerializer** | `string` | Basic types | Default, debugging, general use |
| **MsgpackSerializer** | `Buffer` | Basic + Binary + Date | High traffic, binary data |

## ISerializer Interface

```typescript
import { type ISerializer } from '@nestjs-redisx/cache';
```

| Method | Signature | Description |
|--------|-----------|-------------|
| `serialize` | `<T>(value: T) => string \| Buffer` | Converts value to storage format |
| `deserialize` | `<T>(data: string \| Buffer) => T` | Restores value from storage format. Throws `SerializationError` on failure. |
| `tryDeserialize` | `<T>(data: string \| Buffer) => T \| null` | Safe version — returns `null` on error instead of throwing |
| `getContentType` | `() => string` | Content type identifier (e.g. `'application/json'`, `'application/msgpack'`) |

## JsonSerializer

```typescript
import { JsonSerializer } from '@nestjs-redisx/cache';

const serializer = new JsonSerializer();

const data = { id: 1, name: 'John', active: true };
const serialized = serializer.serialize(data);
// '{"id":1,"name":"John","active":true}'

const deserialized = serializer.deserialize<typeof data>(serialized);
// { id: 1, name: 'John', active: true }

// Safe deserialization (returns null on error)
const invalid = serializer.tryDeserialize('not json');  // null

serializer.getContentType();  // 'application/json'
```

**Pros:**
- Human readable in Redis (`redis-cli GET key` shows JSON)
- No extra dependencies
- Wide compatibility

**Cons:**
- Larger payload size
- `Date` → ISO string (loses type), `Buffer` → `{ type: 'Buffer', data: [...] }`

## MsgpackSerializer

Uses the `msgpackr` package (optional dependency, lazy-loaded).

```bash
npm install msgpackr
```

```typescript
import { MsgpackSerializer } from '@nestjs-redisx/cache';

const serializer = new MsgpackSerializer();

const data = { id: 1, name: 'John', tags: ['user', 'active'] };
const serialized = serializer.serialize(data);
// Buffer<...> (binary, ~30-40% smaller than JSON)

const deserialized = serializer.deserialize<typeof data>(serialized);
// { id: 1, name: 'John', tags: ['user', 'active'] }

serializer.getContentType();  // 'application/msgpack'
```

**Size comparison utility:**

```typescript
const comparison = serializer.compareWithJson({ id: 1, name: 'John', tags: ['user'] });
// { jsonSize: 42, msgpackSize: 30, compressionRatio: 1.4 }
```

**Pros:**
- ~30-40% smaller than JSON
- Handles `Date`, `Buffer` natively
- Faster serialization

**Cons:**
- Not human readable in Redis
- Extra dependency (`msgpackr`)

::: warning msgpackr not installed
If `msgpackr` is not installed, `new MsgpackSerializer()` throws immediately:
```
Error: msgpackr package is required for MsgpackSerializer. Install with: npm install msgpackr
```
:::

## Custom Serializer

Implement all 4 methods of the `ISerializer` interface:

<<< @/apps/demo/src/plugins/cache/serializer-custom.usage.ts{typescript}

## Using a Custom Serializer with the Plugin

The plugin does not have a `serializer` config option. To replace the internal serializer, override the `SERIALIZER` provider manually in your module:

<<< @/apps/demo/src/plugins/cache/serializer-override.setup.ts{typescript}

::: warning Type compatibility
The internal `Serializer` domain service handles `string` only. `JsonSerializer` and `MsgpackSerializer` implement `ISerializer` which handles `string | Buffer`. When overriding, ensure the Redis driver can store the output format (Buffer is supported by ioredis).
:::

## What Can Be Cached?

| Type | JSON | MsgPack | Notes |
|------|------|---------|-------|
| Primitives (string, number, boolean) | Yes | Yes | |
| `null` | Yes | Yes | |
| Plain objects | Yes | Yes | |
| Arrays | Yes | Yes | |
| `Date` | Becomes ISO string | Preserved | JSON requires manual parsing on read |
| `Buffer` | Becomes `{ type, data }` | Preserved | |
| `Map` / `Set` | No (convert to array first) | No (convert to array first) | |
| Class instances | Data only (methods lost) | Data only (methods lost) | Reconstruct manually |
| Circular references | Throws `SerializationError` | Throws `SerializationError` | |

## Handling Special Types

### Dates

```typescript
// JSON — dates become strings
const user = { created: new Date('2025-01-28') };
// Stored: { "created": "2025-01-28T00:00:00.000Z" }
// On read: user.created is a string, not Date

// To restore:
const cached = await cache.get<{ created: string }>('user:1');
const date = new Date(cached.created);
```

### Class Instances

```typescript
class User {
  constructor(public id: string, public name: string) {}
  getDisplayName() { return `User: ${this.name}`; }
}

const user = new User('123', 'John');
await cache.set('user:123', user);

const cached = await cache.get<User>('user:123');
// cached.id, cached.name — work fine
// cached.getDisplayName() — TypeError: not a function

// Solution: reconstruct
const restored = Object.assign(new User('', ''), cached);
```

## Best Practices

### Use JSON (default) when:
- Debugging / inspecting cache in Redis is important
- Data is mostly strings and numbers
- Payload size is not a concern

### Use MsgPack when:
- High traffic (save bandwidth and Redis memory)
- Binary data (images, files)
- Dates must be preserved without manual parsing
- Every byte matters (large payloads)

### Use Custom when:
- Compression required (very large payloads)
- Encryption at rest
- Special encoding (Protocol Buffers, BSON)

## Next Steps

- [Eviction Strategies](./strategies) — Memory management
- [Monitoring](./monitoring) — Track cache performance
