import { createHash } from 'crypto';

import { MemoryStore } from '../../domain/store/memory-store';
import { LuaInterpreter } from '../../domain/lua/lua-interpreter';
import { MemoryDriverError } from '../../../shared/errors';
import { ICommandExecutor } from '../ports/command-executor.port';

const OK = 'OK';

/** Converts a Redis glob pattern to a RegExp (supports * and ?). */
function globToRegExp(glob: string): RegExp {
  let re = '^';
  for (const ch of glob) {
    if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else if ('.+^${}()|\\/['.includes(ch)) re += `\\${ch}`;
    else re += ch;
  }
  return new RegExp(`${re}$`);
}

type ScoreBound = {
  value: number;
  exclusive: boolean;
};

function parseScoreBound(raw: unknown): ScoreBound {
  let str = String(raw);
  let exclusive = false;
  if (str.startsWith('(')) {
    exclusive = true;
    str = str.slice(1);
  }
  if (str === '-inf') return { value: -Infinity, exclusive };
  if (str === '+inf' || str === 'inf') return { value: Infinity, exclusive };
  return { value: Number(str), exclusive };
}

/**
 * Executes Redis commands against an in-memory store, returning Redis-shaped
 * replies that match what `BaseRedisDriver` expects from `executeCommand`.
 * Also runs Lua scripts (EVAL/EVALSHA) via the interpreter, whose `redis.call`
 * re-enters this same executor (single-threaded → atomic, like Redis).
 */
export class CommandExecutor implements ICommandExecutor {
  private readonly scripts = new Map<string, string>();
  private readonly redisCall = (command: string, args: Array<string | number>): unknown => this.execute(command, args);

  constructor(
    private readonly store: MemoryStore,
    private readonly interpreter: LuaInterpreter = new LuaInterpreter(),
  ) {}

  execute(command: string, args: unknown[]): unknown {
    const cmd = command.toUpperCase();
    switch (cmd) {
      // --- connection / server ---
      case 'PING':
        return args.length ? this.str(args[0]) : 'PONG';
      case 'DBSIZE':
        return this.store.keys().length;
      case 'FLUSHDB':
      case 'FLUSHALL':
        this.store.flush();
        return OK;

      // --- strings ---
      case 'GET':
        return this.store.read(this.str(args[0]), 'string') ?? null;
      case 'SET':
        return this.cmdSet(args);
      case 'SETEX':
        return this.cmdSet([args[0], args[2], 'EX', args[1]]);
      case 'SETNX':
        return this.cmdSet([args[0], args[1], 'NX']) === OK ? 1 : 0;
      case 'DEL':
      case 'UNLINK':
        return args.reduce<number>((acc, k) => acc + (this.store.delete(this.str(k)) ? 1 : 0), 0);
      case 'EXISTS':
        return args.reduce<number>((acc, k) => acc + (this.store.has(this.str(k)) ? 1 : 0), 0);
      case 'INCR':
        return this.incrBy(this.str(args[0]), 1);
      case 'INCRBY':
        return this.incrBy(this.str(args[0]), this.num(args[1]));
      case 'DECR':
        return this.incrBy(this.str(args[0]), -1);
      case 'DECRBY':
        return this.incrBy(this.str(args[0]), -this.num(args[1]));
      case 'APPEND': {
        const key = this.str(args[0]);
        const cur = this.store.read(key, 'string') ?? '';
        const next = cur + this.str(args[1]);
        this.preserveTtl(key, () => this.store.writeString(key, next));
        return next.length;
      }
      case 'STRLEN':
        return (this.store.read(this.str(args[0]), 'string') ?? '').length;
      case 'MGET':
        return args.map((k) => this.store.read(this.str(k), 'string') ?? null);
      case 'MSET': {
        for (let i = 0; i < args.length; i += 2) this.store.writeString(this.str(args[i]), this.str(args[i + 1]));
        return OK;
      }

      // --- keys / TTL ---
      case 'EXPIRE':
        return this.store.setExpireAt(this.str(args[0]), this.store.now() + this.num(args[1]) * 1000) ? 1 : 0;
      case 'PEXPIRE':
        return this.store.setExpireAt(this.str(args[0]), this.store.now() + this.num(args[1])) ? 1 : 0;
      case 'EXPIREAT':
        return this.store.setExpireAt(this.str(args[0]), this.num(args[1]) * 1000) ? 1 : 0;
      case 'PEXPIREAT':
        return this.store.setExpireAt(this.str(args[0]), this.num(args[1])) ? 1 : 0;
      case 'PERSIST':
        return this.store.setExpireAt(this.str(args[0]), null) ? 1 : 0;
      case 'TTL': {
        const ms = this.store.pttl(this.str(args[0]));
        return ms < 0 ? ms : Math.ceil(ms / 1000);
      }
      case 'PTTL':
        return this.store.pttl(this.str(args[0]));
      case 'TYPE':
        return this.store.type(this.str(args[0]));
      case 'KEYS': {
        const re = globToRegExp(this.str(args[0]));
        return this.store.keys().filter((k) => re.test(k));
      }
      case 'SCAN':
        return this.cmdScan(args);

      // --- hashes ---
      case 'HSET':
      case 'HMSET':
        return this.cmdHset(cmd, args);
      case 'HGET': {
        const hash = this.store.read(this.str(args[0]), 'hash');
        return hash?.get(this.str(args[1])) ?? null;
      }
      case 'HMGET': {
        const hash = this.store.read(this.str(args[0]), 'hash');
        return args.slice(1).map((f) => hash?.get(this.str(f)) ?? null);
      }
      case 'HGETALL': {
        const hash = this.store.read(this.str(args[0]), 'hash');
        const obj: Record<string, string> = {};
        if (hash) for (const [f, v] of hash) obj[f] = v;
        return obj;
      }
      case 'HDEL': {
        const key = this.str(args[0]);
        const hash = this.store.read(key, 'hash');
        if (!hash) return 0;
        let removed = 0;
        for (const f of args.slice(1)) if (hash.delete(this.str(f))) removed++;
        if (hash.size === 0) this.store.delete(key);
        return removed;
      }
      case 'HEXISTS':
        return this.store.read(this.str(args[0]), 'hash')?.has(this.str(args[1])) ? 1 : 0;
      case 'HLEN':
        return this.store.read(this.str(args[0]), 'hash')?.size ?? 0;
      case 'HKEYS':
        return [...(this.store.read(this.str(args[0]), 'hash')?.keys() ?? [])];
      case 'HVALS':
        return [...(this.store.read(this.str(args[0]), 'hash')?.values() ?? [])];
      case 'HINCRBY': {
        const key = this.str(args[0]);
        const field = this.str(args[1]);
        const hash = this.store.readOrCreate(key, 'hash');
        const next = Number(hash.get(field) ?? '0') + this.num(args[2]);
        hash.set(field, String(next));
        return next;
      }

      // --- lists ---
      case 'LPUSH': {
        const list = this.store.readOrCreate(this.str(args[0]), 'list');
        for (const v of args.slice(1)) list.unshift(this.str(v));
        return list.length;
      }
      case 'RPUSH': {
        const list = this.store.readOrCreate(this.str(args[0]), 'list');
        for (const v of args.slice(1)) list.push(this.str(v));
        return list.length;
      }
      case 'LPOP':
      case 'RPOP':
        return this.cmdPop(cmd, args);
      case 'LLEN':
        return this.store.read(this.str(args[0]), 'list')?.length ?? 0;
      case 'LRANGE':
        return this.cmdLrange(args);
      case 'LINDEX': {
        const list = this.store.read(this.str(args[0]), 'list');
        if (!list) return null;
        let idx = this.num(args[1]);
        if (idx < 0) idx = list.length + idx;
        return list[idx] ?? null;
      }
      case 'LREM': {
        const key = this.str(args[0]);
        const list = this.store.read(key, 'list');
        if (!list) return 0;
        const target = this.str(args[2]);
        const before = list.length;
        const kept = list.filter((v) => v !== target);
        list.length = 0;
        list.push(...kept);
        if (list.length === 0) this.store.delete(key);
        return before - list.length;
      }

      // --- sets ---
      case 'SADD': {
        const set = this.store.readOrCreate(this.str(args[0]), 'set');
        let added = 0;
        for (const m of args.slice(1)) {
          const member = this.str(m);
          if (!set.has(member)) {
            set.add(member);
            added++;
          }
        }
        return added;
      }
      case 'SREM': {
        const key = this.str(args[0]);
        const set = this.store.read(key, 'set');
        if (!set) return 0;
        let removed = 0;
        for (const m of args.slice(1)) if (set.delete(this.str(m))) removed++;
        if (set.size === 0) this.store.delete(key);
        return removed;
      }
      case 'SMEMBERS':
        return [...(this.store.read(this.str(args[0]), 'set') ?? [])];
      case 'SISMEMBER':
        return this.store.read(this.str(args[0]), 'set')?.has(this.str(args[1])) ? 1 : 0;
      case 'SCARD':
        return this.store.read(this.str(args[0]), 'set')?.size ?? 0;

      // --- sorted sets ---
      case 'ZADD':
        return this.cmdZadd(args);
      case 'ZCARD':
        return this.store.read(this.str(args[0]), 'zset')?.size ?? 0;
      case 'ZSCORE': {
        const score = this.store.read(this.str(args[0]), 'zset')?.get(this.str(args[1]));
        return score === undefined ? null : String(score);
      }
      case 'ZREM': {
        const key = this.str(args[0]);
        const zset = this.store.read(key, 'zset');
        if (!zset) return 0;
        let removed = 0;
        for (const m of args.slice(1)) if (zset.delete(this.str(m))) removed++;
        if (zset.size === 0) this.store.delete(key);
        return removed;
      }
      case 'ZRANGE':
        return this.cmdZrange(args);
      case 'ZRANGEBYSCORE':
        return this.cmdZrangeByScore(args);
      case 'ZREMRANGEBYSCORE':
        return this.cmdZremRangeByScore(args);
      case 'ZCOUNT': {
        const zset = this.store.read(this.str(args[0]), 'zset');
        if (!zset) return 0;
        const min = parseScoreBound(args[1]);
        const max = parseScoreBound(args[2]);
        return [...zset.values()].filter((s) => this.inRange(s, min, max)).length;
      }

      // --- scripting ---
      case 'SCRIPT':
        if (this.str(args[0]).toUpperCase() === 'LOAD') {
          const source = this.str(args[1]);
          const sha = createHash('sha1').update(source).digest('hex');
          this.scripts.set(sha, source);
          return sha;
        }
        return OK;
      case 'EVAL':
        return this.runScript(this.str(args[0]), args);
      case 'EVALSHA': {
        const sha = this.str(args[0]);
        const source = this.scripts.get(sha);
        if (!source) throw new MemoryDriverError('NOSCRIPT No matching script. Please use EVAL.');
        return this.runScript(source, args);
      }

      default:
        throw new MemoryDriverError(`In-memory driver does not implement command: ${cmd}`);
    }
  }

  // --- helpers --------------------------------------------------------------

  private str(v: unknown): string {
    return String(v);
  }

  private num(v: unknown): number {
    const n = Number(v);
    if (Number.isNaN(n)) throw new MemoryDriverError(`value is not an integer or out of range: ${String(v)}`);
    return n;
  }

  private preserveTtl(key: string, mutate: () => void): void {
    const ttl = this.store.pttl(key);
    mutate();
    if (ttl >= 0) this.store.setExpireAt(key, this.store.now() + ttl);
  }

  private incrBy(key: string, by: number): number {
    const cur = this.store.read(key, 'string');
    const next = (cur === undefined ? 0 : this.num(cur)) + by;
    this.preserveTtl(key, () => this.store.writeString(key, String(next)));
    return next;
  }

  private cmdSet(args: unknown[]): 'OK' | string | null {
    const key = this.str(args[0]);
    const value = this.str(args[1]);
    let nx = false;
    let xx = false;
    let ex: number | undefined;
    let px: number | undefined;
    let getOld = false;
    for (let i = 2; i < args.length; i++) {
      const opt = this.str(args[i]).toUpperCase();
      if (opt === 'NX') nx = true;
      else if (opt === 'XX') xx = true;
      else if (opt === 'GET') getOld = true;
      else if (opt === 'EX') ex = this.num(args[++i]);
      else if (opt === 'PX') px = this.num(args[++i]);
    }
    const exists = this.store.has(key);
    const old = exists ? (this.store.read(key, 'string') ?? null) : null;
    if ((nx && exists) || (xx && !exists)) return getOld ? old : null;
    this.store.writeString(key, value);
    if (ex !== undefined) this.store.setExpireAt(key, this.store.now() + ex * 1000);
    else if (px !== undefined) this.store.setExpireAt(key, this.store.now() + px);
    return getOld ? old : OK;
  }

  private cmdPop(cmd: string, args: unknown[]): string | string[] | null {
    const key = this.str(args[0]);
    const list = this.store.read(key, 'list');
    if (!list || list.length === 0) return args.length > 1 ? [] : null;
    const take = (fn: () => string | undefined): string | undefined => fn();
    const pop = (): string | undefined => (cmd === 'LPOP' ? list.shift() : list.pop());
    if (args.length > 1) {
      const count = this.num(args[1]);
      const out: string[] = [];
      for (let i = 0; i < count && list.length > 0; i++) out.push(take(pop) as string);
      if (list.length === 0) this.store.delete(key);
      return out;
    }
    const value = pop() ?? null;
    if (list.length === 0) this.store.delete(key);
    return value;
  }

  private cmdLrange(args: unknown[]): string[] {
    const list = this.store.read(this.str(args[0]), 'list');
    if (!list) return [];
    const len = list.length;
    let start = this.num(args[1]);
    let stop = this.num(args[2]);
    if (start < 0) start = Math.max(0, len + start);
    if (stop < 0) stop = len + stop;
    return list.slice(start, stop + 1);
  }

  private cmdScan(args: unknown[]): [string, string[]] {
    let match: string | undefined;
    for (let i = 1; i < args.length; i++) {
      const opt = this.str(args[i]).toUpperCase();
      if (opt === 'MATCH') match = this.str(args[++i]);
      else if (opt === 'COUNT') i++; // ignored (single-pass)
    }
    const re = match ? globToRegExp(match) : undefined;
    const keys = re ? this.store.keys().filter((k) => re.test(k)) : this.store.keys();
    return ['0', keys];
  }

  private cmdHset(cmd: string, args: unknown[]): number | 'OK' {
    const hash = this.store.readOrCreate(this.str(args[0]), 'hash');
    let added = 0;
    for (let i = 1; i < args.length; i += 2) {
      const field = this.str(args[i]);
      if (!hash.has(field)) added++;
      hash.set(field, this.str(args[i + 1]));
    }
    return cmd === 'HMSET' ? OK : added;
  }

  private cmdZadd(args: unknown[]): number {
    const zset = this.store.readOrCreate(this.str(args[0]), 'zset');
    let added = 0;
    for (let i = 1; i < args.length; i += 2) {
      const score = this.num(args[i]);
      const member = this.str(args[i + 1]);
      if (!zset.has(member)) added++;
      zset.set(member, score);
    }
    return added;
  }

  private sortedMembers(key: string): Array<[string, number]> {
    const zset = this.store.read(key, 'zset');
    if (!zset) return [];
    return [...zset.entries()].sort((a, b) => (a[1] !== b[1] ? a[1] - b[1] : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }

  private cmdZrange(args: unknown[]): string[] {
    const sorted = this.sortedMembers(this.str(args[0]));
    let start = this.num(args[1]);
    let stop = this.num(args[2]);
    const withScores = args.slice(3).some((a) => this.str(a).toUpperCase() === 'WITHSCORES');
    const len = sorted.length;
    if (start < 0) start = Math.max(0, len + start);
    if (stop < 0) stop = len + stop;
    const slice = sorted.slice(start, stop + 1);
    return this.flatten(slice, withScores);
  }

  private cmdZrangeByScore(args: unknown[]): string[] {
    const sorted = this.sortedMembers(this.str(args[0]));
    const min = parseScoreBound(args[1]);
    const max = parseScoreBound(args[2]);
    const withScores = args.slice(3).some((a) => this.str(a).toUpperCase() === 'WITHSCORES');
    return this.flatten(
      sorted.filter(([, s]) => this.inRange(s, min, max)),
      withScores,
    );
  }

  private cmdZremRangeByScore(args: unknown[]): number {
    const key = this.str(args[0]);
    const zset = this.store.read(key, 'zset');
    if (!zset) return 0;
    const min = parseScoreBound(args[1]);
    const max = parseScoreBound(args[2]);
    let removed = 0;
    for (const [member, score] of [...zset.entries()]) {
      if (this.inRange(score, min, max)) {
        zset.delete(member);
        removed++;
      }
    }
    if (zset.size === 0) this.store.delete(key);
    return removed;
  }

  private inRange(score: number, min: ScoreBound, max: ScoreBound): boolean {
    const okMin = min.exclusive ? score > min.value : score >= min.value;
    const okMax = max.exclusive ? score < max.value : score <= max.value;
    return okMin && okMax;
  }

  private flatten(entries: Array<[string, number]>, withScores: boolean): string[] {
    const out: string[] = [];
    for (const [member, score] of entries) {
      out.push(member);
      if (withScores) out.push(String(score));
    }
    return out;
  }

  private runScript(source: string, args: unknown[]): unknown {
    const numKeys = this.num(args[1]);
    const keys = args.slice(2, 2 + numKeys).map((k) => this.str(k));
    const argv = args.slice(2 + numKeys).map((a) => this.str(a));
    return this.interpreter.run(source, keys, argv, this.redisCall);
  }
}
