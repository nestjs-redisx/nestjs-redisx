import { createHash } from 'crypto';

import { MemoryStore } from '../../domain/store/memory-store';
import { StreamEntry, compareIds } from '../../domain/store/stream-value';
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

      // --- streams ---
      case 'XADD':
        return this.cmdXadd(args);
      case 'XLEN':
        return this.store.read(this.str(args[0]), 'stream')?.len() ?? 0;
      case 'XRANGE':
        return this.cmdXrange(args, false);
      case 'XREVRANGE':
        return this.cmdXrange(args, true);
      case 'XDEL':
        return this.store.read(this.str(args[0]), 'stream')?.del(args.slice(1).map((i) => this.str(i))) ?? 0;
      case 'XTRIM':
        return this.cmdXtrim(args);
      case 'XINFO':
        return this.cmdXinfo(args);
      case 'XGROUP':
        return this.cmdXgroup(args);
      case 'XREADGROUP':
        return this.cmdXreadgroup(args);
      case 'XREAD':
        return this.cmdXread(args);
      case 'XACK':
        return this.cmdXack(args);
      case 'XPENDING':
        return this.cmdXpending(args);
      case 'XCLAIM':
        return this.cmdXclaim(args);

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

  // --- stream helpers -------------------------------------------------------

  /** Formats a stream entry as the Redis reply shape `[id, [field, value, ...]]`. */
  private entryReply(entry: StreamEntry): [string, string[]] {
    return [entry.id, entry.fields];
  }

  private cmdXadd(args: unknown[]): string | null {
    const key = this.str(args[0]);
    let i = 1;
    let noMkStream = false;
    let maxLen: number | undefined;
    let minId: string | undefined;
    for (; i < args.length; ) {
      const opt = this.str(args[i]).toUpperCase();
      if (opt === 'NOMKSTREAM') {
        noMkStream = true;
        i += 1;
      } else if (opt === 'MAXLEN') {
        i += 1;
        if (this.str(args[i]) === '~' || this.str(args[i]) === '=') i += 1;
        maxLen = this.num(args[i]);
        i += 1;
      } else if (opt === 'MINID') {
        i += 1;
        if (this.str(args[i]) === '~' || this.str(args[i]) === '=') i += 1;
        minId = this.str(args[i]);
        i += 1;
      } else {
        break;
      }
    }
    const id = this.str(args[i]);
    const fields = args.slice(i + 1).map((f) => this.str(f));

    if (noMkStream && !this.store.has(key)) return null;
    const stream = this.store.readOrCreate(key, 'stream');
    const newId = stream.add(id, fields, this.store.now());
    if (maxLen !== undefined) stream.trimMaxLen(maxLen);
    if (minId !== undefined) {
      const toDelete = stream
        .range('-', '+')
        .filter((e) => compareIds(e.id, minId) < 0)
        .map((e) => e.id);
      stream.del(toDelete);
    }
    return newId;
  }

  private cmdXrange(args: unknown[], reverse: boolean): Array<[string, string[]]> {
    const stream = this.store.read(this.str(args[0]), 'stream');
    if (!stream) return [];
    // XRANGE: start, end. XREVRANGE: end, start (swapped).
    const start = reverse ? this.str(args[2]) : this.str(args[1]);
    const end = reverse ? this.str(args[1]) : this.str(args[2]);
    let count: number | undefined;
    for (let i = 3; i < args.length; i++) {
      if (this.str(args[i]).toUpperCase() === 'COUNT') count = this.num(args[++i]);
    }
    return stream.range(start, end, count, reverse).map((e) => this.entryReply(e));
  }

  private cmdXtrim(args: unknown[]): number {
    const stream = this.store.read(this.str(args[0]), 'stream');
    if (!stream) return 0;
    let i = 1;
    const strategy = this.str(args[i]).toUpperCase();
    i += 1;
    if (this.str(args[i]) === '~' || this.str(args[i]) === '=') i += 1;
    if (strategy !== 'MAXLEN') throw new MemoryDriverError(`XTRIM strategy not supported: ${strategy}`);
    return stream.trimMaxLen(this.num(args[i]));
  }

  private cmdXinfo(args: unknown[]): unknown[] {
    const sub = this.str(args[0]).toUpperCase();
    if (sub !== 'STREAM') throw new MemoryDriverError(`XINFO subcommand not supported: ${sub}`);
    const stream = this.store.read(this.str(args[1]), 'stream');
    if (!stream) throw new MemoryDriverError('ERR no such key');
    const all = stream.range('-', '+');
    const first = all[0];
    const last = all[all.length - 1];
    return ['length', stream.len(), 'radix-tree-keys', 1, 'radix-tree-nodes', 2, 'last-generated-id', stream.lastId, 'groups', stream.groups.size, 'first-entry', first ? this.entryReply(first) : null, 'last-entry', last ? this.entryReply(last) : null];
  }

  private cmdXgroup(args: unknown[]): unknown {
    const sub = this.str(args[0]).toUpperCase();
    const key = this.str(args[1]);
    const group = this.str(args[2]);
    if (sub === 'CREATE') {
      const id = this.str(args[3]);
      const mkstream = args[4] !== undefined && this.str(args[4]).toUpperCase() === 'MKSTREAM';
      if (!this.store.has(key)) {
        if (!mkstream) throw new MemoryDriverError('ERR The XGROUP subcommand requires the key to exist. Note that for CREATE you may want to use the MKSTREAM option to create an empty stream automatically.');
        this.store.readOrCreate(key, 'stream');
      }
      this.store.read(key, 'stream')!.createGroup(group, id);
      return OK;
    }
    if (sub === 'DESTROY') return this.store.read(key, 'stream')?.destroyGroup(group) ?? 0;
    if (sub === 'DELCONSUMER') return this.store.read(key, 'stream')?.delConsumer(group, this.str(args[3])) ?? 0;
    if (sub === 'SETID') {
      this.store.read(key, 'stream')?.setGroupId(group, this.str(args[3]));
      return OK;
    }
    throw new MemoryDriverError(`XGROUP subcommand not supported: ${sub}`);
  }

  /** Parses the trailing `STREAMS key... id...` section into key/id pairs. */
  private parseStreamsSection(args: unknown[], fromIndex: number): { count?: number; pairs: Array<[string, string]> } {
    let count: number | undefined;
    let i = fromIndex;
    for (; i < args.length; i++) {
      const tok = this.str(args[i]).toUpperCase();
      if (tok === 'STREAMS') {
        i += 1;
        break;
      }
      if (tok === 'COUNT') count = this.num(args[++i]);
      else if (tok === 'BLOCK')
        i += 1; // ignored — the in-memory driver never blocks
      else if (tok === 'NOACK') continue;
    }
    const rest = args.slice(i).map((a) => this.str(a));
    const half = rest.length / 2;
    const keys = rest.slice(0, half);
    const ids = rest.slice(half);
    return { count, pairs: keys.map((k, idx) => [k, ids[idx]!]) };
  }

  private cmdXreadgroup(args: unknown[]): unknown {
    // GROUP <group> <consumer> [COUNT n] [BLOCK ms] [NOACK] STREAMS key... id...
    const group = this.str(args[1]);
    const consumer = this.str(args[2]);
    const noAck = args.slice(3).some((a) => this.str(a).toUpperCase() === 'NOACK');
    const { count, pairs } = this.parseStreamsSection(args, 3);
    const now = this.store.now();
    const out: Array<[string, Array<[string, string[]]>]> = [];
    for (const [key, id] of pairs) {
      const stream = this.store.read(key, 'stream');
      if (!stream) continue;
      const entries = stream.readGroup(group, consumer, id, now, count, noAck);
      if (entries.length > 0) out.push([key, entries.map((e) => this.entryReply(e))]);
    }
    return out.length > 0 ? out : null;
  }

  private cmdXread(args: unknown[]): unknown {
    const { count, pairs } = this.parseStreamsSection(args, 0);
    const out: Array<[string, Array<[string, string[]]>]> = [];
    for (const [key, id] of pairs) {
      const stream = this.store.read(key, 'stream');
      if (!stream) continue;
      const entries = stream.readAfter(id, count);
      if (entries.length > 0) out.push([key, entries.map((e) => this.entryReply(e))]);
    }
    return out.length > 0 ? out : null;
  }

  private cmdXack(args: unknown[]): number {
    const stream = this.store.read(this.str(args[0]), 'stream');
    const group = this.str(args[1]);
    if (!stream?.groups.has(group)) return 0;
    return stream.ack(
      group,
      args.slice(2).map((i) => this.str(i)),
    );
  }

  private cmdXpending(args: unknown[]): unknown {
    const stream = this.store.read(this.str(args[0]), 'stream');
    const group = this.str(args[1]);
    const now = this.store.now();
    if (args.length <= 2) {
      // Summary form: [count, minId, maxId, [[consumer, countStr], ...] | nil]
      if (!stream?.groups.has(group)) return [0, null, null, null];
      const s = stream.pendingSummary(group);
      return [s.count, s.minId, s.maxId, s.consumers.length > 0 ? s.consumers.map(([name, c]) => [name, String(c)]) : null];
    }
    // Range form: [key, group, start, end, count, (consumer)?]
    if (!stream?.groups.has(group)) return [];
    const start = this.str(args[2]);
    const end = this.str(args[3]);
    const count = this.num(args[4]);
    const consumer = args[5] !== undefined ? this.str(args[5]) : undefined;
    return stream.pendingRange(group, start, end, count, now, consumer).map((p) => [p.id, p.consumer, p.idleTime, p.deliveryCount]);
  }

  private cmdXclaim(args: unknown[]): Array<[string, string[]]> {
    const stream = this.store.read(this.str(args[0]), 'stream');
    const group = this.str(args[1]);
    if (!stream?.groups.has(group)) return [];
    const consumer = this.str(args[2]);
    const minIdle = this.num(args[3]);
    // Remaining args are ids until an option keyword appears (IDLE/TIME/RETRYCOUNT/FORCE/JUSTID).
    const ids: string[] = [];
    for (let i = 4; i < args.length; i++) {
      const tok = this.str(args[i]);
      if (['IDLE', 'TIME', 'RETRYCOUNT', 'FORCE', 'JUSTID', 'LASTID'].includes(tok.toUpperCase())) break;
      ids.push(tok);
    }
    return stream.claim(group, consumer, minIdle, ids, this.store.now()).map((e) => this.entryReply(e));
  }

  private runScript(source: string, args: unknown[]): unknown {
    const numKeys = this.num(args[1]);
    const keys = args.slice(2, 2 + numKeys).map((k) => this.str(k));
    const argv = args.slice(2 + numKeys).map((a) => this.str(a));
    return this.interpreter.run(source, keys, argv, this.redisCall);
  }
}
