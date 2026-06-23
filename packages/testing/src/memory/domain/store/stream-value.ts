import { MemoryDriverError } from '../../../shared/errors';

/** A single stream entry: an id and a flat [field, value, ...] array. */
export type StreamEntry = {
  id: string;
  fields: string[];
};

/** A pending (delivered, not-yet-acked) entry in a group's PEL. */
export type PendingEntry = {
  consumer: string;
  /** Last delivery time (epoch ms) — used to compute idle time. */
  deliveryTime: number;
  deliveryCount: number;
};

/** A consumer group: its delivery cursor and pending-entries list (PEL). */
export type StreamGroup = {
  lastDeliveredId: string;
  pending: Map<string, PendingEntry>;
  consumers: Set<string>;
};

/** Parsed stream id `<ms>-<seq>`. */
type ParsedId = { ms: number; seq: number };

function parseId(id: string): ParsedId {
  const [msPart, seqPart = '0'] = id.split('-');
  return { ms: Number(msPart), seq: Number(seqPart) };
}

/** Compares two `<ms>-<seq>` ids. Returns <0, 0, or >0. */
export function compareIds(a: string, b: string): number {
  const pa = parseId(a);
  const pb = parseId(b);
  return pa.ms !== pb.ms ? pa.ms - pb.ms : pa.seq - pb.seq;
}

/** Resolves a range bound token (`-`, `+`, `(id`, `id`, or `ms`) to an id + exclusivity. */
function resolveRangeBound(token: string, isStart: boolean): { id: string; exclusive: boolean } {
  let exclusive = false;
  let t = token;
  if (t.startsWith('(')) {
    exclusive = true;
    t = t.slice(1);
  }
  if (t === '-') return { id: '0-0', exclusive };
  if (t === '+') return { id: `${Number.MAX_SAFE_INTEGER}-${Number.MAX_SAFE_INTEGER}`, exclusive };
  // A bare `ms` (no `-seq`) spans the whole millisecond: seq 0 for start, max for end.
  if (!t.includes('-')) t = isStart ? `${t}-0` : `${t}-${Number.MAX_SAFE_INTEGER}`;
  return { id: t, exclusive };
}

/**
 * In-memory Redis Stream: an ordered entry log plus consumer groups with
 * per-group delivery cursors and pending-entries lists (PEL). Pure data
 * structure — the caller passes the current time so it stays deterministic.
 */
export class StreamValue {
  readonly entries: StreamEntry[] = [];
  lastId = '0-0';
  readonly groups = new Map<string, StreamGroup>();

  /** Computes the next auto id (`*`) given the current time, keeping ids monotonic. */
  private nextAutoId(now: number): string {
    const last = parseId(this.lastId);
    if (now > last.ms) return `${now}-0`;
    return `${last.ms}-${last.seq + 1}`;
  }

  /** Resolves an explicit or `*` id for XADD, validating monotonicity. */
  private resolveAddId(id: string, now: number): string {
    if (id === '*') return this.nextAutoId(now);
    // Support `ms-*` (auto seq within a millisecond).
    let resolved = id;
    if (id.endsWith('-*')) {
      const ms = Number(id.slice(0, -2));
      const last = parseId(this.lastId);
      resolved = last.ms === ms ? `${ms}-${last.seq + 1}` : `${ms}-0`;
    }
    if (compareIds(resolved, this.lastId) <= 0 && this.lastId !== '0-0') {
      throw new MemoryDriverError('ERR The ID specified in XADD is equal or smaller than the target stream top item');
    }
    return resolved;
  }

  /** Appends an entry. Returns its id. */
  add(id: string, fields: string[], now: number): string {
    const resolved = this.resolveAddId(id, now);
    this.entries.push({ id: resolved, fields });
    this.lastId = resolved;
    return resolved;
  }

  len(): number {
    return this.entries.length;
  }

  /** Entries within [start, end] (inclusive bounds, `-`/`+`/`(` supported). */
  range(start: string, end: string, count?: number, reverse = false): StreamEntry[] {
    const lo = resolveRangeBound(start, true);
    const hi = resolveRangeBound(end, false);
    let out = this.entries.filter((e) => {
      const geLo = lo.exclusive ? compareIds(e.id, lo.id) > 0 : compareIds(e.id, lo.id) >= 0;
      const leHi = hi.exclusive ? compareIds(e.id, hi.id) < 0 : compareIds(e.id, hi.id) <= 0;
      return geLo && leHi;
    });
    if (reverse) out = out.reverse();
    if (count !== undefined && count >= 0) out = out.slice(0, count);
    return out;
  }

  /** Deletes entries by id. Returns the number removed. */
  del(ids: string[]): number {
    let removed = 0;
    for (const id of ids) {
      const idx = this.entries.findIndex((e) => e.id === id);
      if (idx !== -1) {
        this.entries.splice(idx, 1);
        removed += 1;
      }
    }
    return removed;
  }

  /** Trims to at most `maxLen` newest entries. Returns the number removed. */
  trimMaxLen(maxLen: number): number {
    if (maxLen < 0 || this.entries.length <= maxLen) return 0;
    const removed = this.entries.length - maxLen;
    this.entries.splice(0, removed);
    return removed;
  }

  // --- consumer groups ------------------------------------------------------

  createGroup(name: string, startId: string): void {
    if (this.groups.has(name)) {
      throw new MemoryDriverError(`BUSYGROUP Consumer Group name already exists`);
    }
    const lastDeliveredId = startId === '$' ? this.lastId : startId === '0' ? '0-0' : startId;
    this.groups.set(name, { lastDeliveredId, pending: new Map(), consumers: new Set() });
  }

  destroyGroup(name: string): number {
    return this.groups.delete(name) ? 1 : 0;
  }

  setGroupId(name: string, id: string): void {
    const group = this.requireGroup(name);
    group.lastDeliveredId = id === '$' ? this.lastId : id === '0' ? '0-0' : id;
  }

  delConsumer(name: string, consumer: string): number {
    const group = this.requireGroup(name);
    let removed = 0;
    for (const [id, p] of group.pending) {
      if (p.consumer === consumer) {
        group.pending.delete(id);
        removed += 1;
      }
    }
    group.consumers.delete(consumer);
    return removed;
  }

  private requireGroup(name: string): StreamGroup {
    const group = this.groups.get(name);
    if (!group) throw new MemoryDriverError(`NOGROUP No such consumer group '${name}'`);
    return group;
  }

  /**
   * XREADGROUP semantics. `id === '>'` delivers never-delivered entries and adds
   * them to the consumer's PEL; an explicit id re-reads that consumer's pending
   * history with id greater than the given one.
   */
  readGroup(name: string, consumer: string, id: string, now: number, count: number | undefined, noAck: boolean): StreamEntry[] {
    const group = this.requireGroup(name);
    group.consumers.add(consumer);

    if (id === '>') {
      let fresh = this.entries.filter((e) => compareIds(e.id, group.lastDeliveredId) > 0);
      if (count !== undefined) fresh = fresh.slice(0, count);
      for (const entry of fresh) {
        group.lastDeliveredId = entry.id;
        if (!noAck) group.pending.set(entry.id, { consumer, deliveryTime: now, deliveryCount: 1 });
      }
      return fresh;
    }

    // History re-read: this consumer's pending entries with id >= given.
    const from = resolveRangeBound(id, true);
    const pendingIds = [...group.pending.entries()]
      .filter(([eid, p]) => p.consumer === consumer && compareIds(eid, from.id) >= 0)
      .map(([eid]) => eid)
      .sort(compareIds);
    const limited = count !== undefined ? pendingIds.slice(0, count) : pendingIds;
    return limited.map((eid) => this.entries.find((e) => e.id === eid)).filter((e): e is StreamEntry => e !== undefined);
  }

  ack(name: string, ids: string[]): number {
    const group = this.requireGroup(name);
    let acked = 0;
    for (const id of ids) {
      if (group.pending.delete(id)) acked += 1;
    }
    return acked;
  }

  /** XPENDING summary: total, min/max pending id, and per-consumer counts. */
  pendingSummary(name: string): { count: number; minId: string | null; maxId: string | null; consumers: Array<[string, number]> } {
    const group = this.requireGroup(name);
    const ids = [...group.pending.keys()].sort(compareIds);
    const perConsumer = new Map<string, number>();
    for (const p of group.pending.values()) perConsumer.set(p.consumer, (perConsumer.get(p.consumer) ?? 0) + 1);
    return {
      count: ids.length,
      minId: ids[0] ?? null,
      maxId: ids[ids.length - 1] ?? null,
      consumers: [...perConsumer.entries()],
    };
  }

  /** XPENDING range: pending entries in [start,end], optionally filtered by consumer. */
  pendingRange(name: string, start: string, end: string, count: number, now: number, consumer?: string): Array<{ id: string; consumer: string; idleTime: number; deliveryCount: number }> {
    const group = this.requireGroup(name);
    const lo = resolveRangeBound(start, true);
    const hi = resolveRangeBound(end, false);
    return [...group.pending.entries()]
      .filter(([id]) => compareIds(id, lo.id) >= 0 && compareIds(id, hi.id) <= 0)
      .filter(([, p]) => (consumer ? p.consumer === consumer : true))
      .sort((a, b) => compareIds(a[0], b[0]))
      .slice(0, count)
      .map(([id, p]) => ({ id, consumer: p.consumer, idleTime: Math.max(0, now - p.deliveryTime), deliveryCount: p.deliveryCount }));
  }

  /** XCLAIM: reassign pending entries idle >= minIdle to `consumer`. Returns claimed entries. */
  claim(name: string, consumer: string, minIdle: number, ids: string[], now: number): StreamEntry[] {
    const group = this.requireGroup(name);
    group.consumers.add(consumer);
    const claimed: StreamEntry[] = [];
    for (const id of ids) {
      const p = group.pending.get(id);
      if (!p) continue;
      if (now - p.deliveryTime < minIdle) continue;
      const entry = this.entries.find((e) => e.id === id);
      if (!entry) {
        // Entry was deleted from the stream — drop it from the PEL like Redis does.
        group.pending.delete(id);
        continue;
      }
      group.pending.set(id, { consumer, deliveryTime: now, deliveryCount: p.deliveryCount + 1 });
      claimed.push(entry);
    }
    return claimed;
  }

  /** Entries strictly greater than `id` (XREAD); `$` resolves to the current last id. */
  readAfter(id: string, count?: number): StreamEntry[] {
    const after = id === '$' ? this.lastId : resolveRangeBound(id, true).id;
    let out = this.entries.filter((e) => compareIds(e.id, after) > 0);
    if (count !== undefined) out = out.slice(0, count);
    return out;
  }
}
