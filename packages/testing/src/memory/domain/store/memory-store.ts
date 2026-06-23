import { WrongTypeError } from '../../../shared/errors';

/**
 * Tagged union of the Redis value types the in-memory store supports (Phase 1).
 * Streams are added in Phase 2.
 */
export type StoredValue = { kind: 'string'; value: string } | { kind: 'hash'; value: Map<string, string> } | { kind: 'set'; value: Set<string> } | { kind: 'zset'; value: Map<string, number> } | { kind: 'list'; value: string[] };

export type RedisValueKind = StoredValue['kind'];

/** The concrete value type backing a given Redis kind. */
export type ValueOfKind<K extends RedisValueKind> = K extends 'string' ? string : K extends 'hash' ? Map<string, string> : K extends 'set' ? Set<string> : K extends 'zset' ? Map<string, number> : K extends 'list' ? string[] : never;

type Entry = {
  data: StoredValue;
  /** Absolute expiry in epoch ms, or null for no expiry. */
  expireAt: number | null;
};

/**
 * A single in-memory Redis keyspace with lazy TTL expiry.
 *
 * Pure data structure (no NestJS, no I/O). All command behavior lives in the
 * application CommandExecutor; the store only stores and type-checks.
 */
export class MemoryStore {
  private readonly keyspace = new Map<string, Entry>();

  /** Current logical time (epoch ms). Overridable for deterministic TTL tests. */
  now(): number {
    return Date.now();
  }

  /** Returns the live entry for a key, lazily evicting it if expired. */
  private live(key: string): Entry | undefined {
    const entry = this.keyspace.get(key);
    if (!entry) return undefined;
    if (entry.expireAt !== null && entry.expireAt <= this.now()) {
      this.keyspace.delete(key);
      return undefined;
    }
    return entry;
  }

  has(key: string): boolean {
    return this.live(key) !== undefined;
  }

  /** Deletes a key. Returns true if a live key was removed. */
  delete(key: string): boolean {
    const existed = this.live(key) !== undefined;
    this.keyspace.delete(key);
    return existed;
  }

  /** Returns the Redis type name, or 'none' if missing. */
  type(key: string): string {
    return this.live(key)?.data.kind ?? 'none';
  }

  flush(): void {
    this.keyspace.clear();
  }

  keys(): string[] {
    const out: string[] = [];
    for (const key of [...this.keyspace.keys()]) {
      if (this.has(key)) out.push(key);
    }
    return out;
  }

  // --- expiry ---------------------------------------------------------------

  /** Sets absolute expiry (epoch ms) or null to persist. Returns true if key exists. */
  setExpireAt(key: string, atMs: number | null): boolean {
    const entry = this.live(key);
    if (!entry) return false;
    entry.expireAt = atMs;
    return true;
  }

  /** Remaining TTL in ms: -2 missing, -1 no expiry, else >= 0. */
  pttl(key: string): number {
    const entry = this.live(key);
    if (!entry) return -2;
    if (entry.expireAt === null) return -1;
    return Math.max(0, entry.expireAt - this.now());
  }

  // --- typed access ---------------------------------------------------------

  /** Reads a container of the expected kind; undefined if missing; throws on type mismatch. */
  read<K extends RedisValueKind>(key: string, kind: K): ValueOfKind<K> | undefined {
    const entry = this.live(key);
    if (!entry) return undefined;
    if (entry.data.kind !== kind) throw new WrongTypeError();
    return entry.data.value as unknown as ValueOfKind<K>;
  }

  /** Gets the existing container of `kind`, creating an empty one (no expiry) if absent. Throws on type mismatch. */
  readOrCreate<K extends RedisValueKind>(key: string, kind: K): ValueOfKind<K> {
    const existing = this.read(key, kind);
    if (existing !== undefined) return existing;
    const value = this.emptyContainer(kind);
    this.keyspace.set(key, { data: { kind, value } as unknown as StoredValue, expireAt: null });
    return value as unknown as ValueOfKind<K>;
  }

  /** Overwrites a key with a string value, clearing any previous type and expiry. */
  writeString(key: string, value: string): void {
    this.keyspace.set(key, { data: { kind: 'string', value }, expireAt: null });
  }

  private emptyContainer(kind: RedisValueKind): StoredValue['value'] {
    switch (kind) {
      case 'string':
        return '';
      case 'hash':
        return new Map<string, string>();
      case 'set':
        return new Set<string>();
      case 'zset':
        return new Map<string, number>();
      case 'list':
        return [];
    }
  }
}
