import { Injectable, Inject, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { IRedisDriver } from '@nestjs-redisx/core';

import { SESSION_PLUGIN_OPTIONS, SESSION_REDIS_DRIVER, DEFAULT_SESSION_CONFIG } from '../../../shared/constants';
import { SessionError, SessionLimitExceededError, SessionSerializationError, SessionStoreError } from '../../../shared/errors';
import { ISessionActivity, ISessionEventInfo, ISessionEvents, ISessionMetadata, ISessionPluginOptions, ISessionSetOptions, SessionEndReason } from '../../../shared/types';
import { defaultUserIdExtractor, parseSessionMetadata } from '../../domain/session-metadata';
import { ISessionStore } from '../../application/ports/session-store.port';
import { COUNT_INDEX_SCRIPT, DESTROY_SESSION_SCRIPT, GET_SESSION_SCRIPT, RANGE_INDEX_SCRIPT, RECORD_ACTIVITY_SCRIPT, RESERVE_USER_SLOT_SCRIPT, SET_SESSION_SCRIPT, TOUCH_SESSION_SCRIPT } from '../scripts/lua-scripts';

// Optional metrics integration (same soft-dependency pattern as pubsub/locks)
const METRICS_SERVICE = Symbol.for('METRICS_SERVICE');

interface IMetricsService {
  incrementCounter(name: string, labels?: Record<string, string>, value?: number): void;
}

/** Script registry: symbolic name -> source (names appear in the `-- session:<name>` markers). */
const SCRIPTS = {
  set: SET_SESSION_SCRIPT,
  get: GET_SESSION_SCRIPT,
  touch: TOUCH_SESSION_SCRIPT,
  destroy: DESTROY_SESSION_SCRIPT,
  reserve: RESERVE_USER_SLOT_SCRIPT,
  count: COUNT_INDEX_SCRIPT,
  range: RANGE_INDEX_SCRIPT,
  activity: RECORD_ACTIVITY_SCRIPT,
} as const;

type ScriptName = keyof typeof SCRIPTS;

/**
 * Redis-based session store.
 *
 * Keyspace (default prefix `sess:`):
 * - `sess:{<sid>}` — middleware payload as JSON (hash-tagged with its metadata)
 * - `sess:{<sid>}:meta` — metadata hash (userId, ip, userAgent, timestamps)
 * - `sess:user:<userId>` — per-user ZSET `sid -> expiresAtMs`
 * - `sess:index` — global ZSET `sid -> expiresAtMs`
 *
 * Payload+metadata operations are atomic Lua on one cluster slot; index
 * operations are single-key (cluster-safe) and always go through the reserve
 * script, which also keeps the index KEY's TTL at least as long as its
 * longest-lived refresh. Cross-key sequences (eviction, index cleanup after
 * destroy) are best-effort — stale index entries are swept lazily by score.
 *
 * Time is obtained here via Date.now() and passed into the scripts as ARGV —
 * the Lua never reads time itself.
 */
@Injectable()
export class RedisSessionStoreAdapter implements ISessionStore, OnModuleInit {
  private readonly logger = new Logger(RedisSessionStoreAdapter.name);
  private readonly shas = new Map<ScriptName, string>();

  constructor(
    @Inject(SESSION_REDIS_DRIVER) private readonly driver: IRedisDriver,
    @Inject(SESSION_PLUGIN_OPTIONS) private readonly options: ISessionPluginOptions,
    @Optional() @Inject(METRICS_SERVICE) private readonly metrics?: IMetricsService,
  ) {}

  /**
   * Pre-load Lua scripts on module initialization.
   */
  async onModuleInit(): Promise<void> {
    try {
      for (const [name, script] of Object.entries(SCRIPTS) as Array<[ScriptName, string]>) {
        this.shas.set(name, await this.driver.scriptLoad(script));
      }
    } catch (error) {
      throw new SessionStoreError(`Failed to load Lua scripts: ${(error as Error).message}`, error as Error);
    }
  }

  async get(sessionId: string): Promise<unknown | null> {
    try {
      this.assertSessionId(sessionId);
      const result = (await this.runScript('get', this.sessionKeys(sessionId), [Date.now(), this.capMs()])) as Array<number | string>;
      const status = result[0];

      if (status === -1) {
        await this.onCapExpired(sessionId, this.asUserId(result[1]));
        return null;
      }
      if (status !== 1) {
        return null;
      }

      try {
        return JSON.parse(result[1] as string) as unknown;
      } catch {
        // Self-heal: a corrupt payload would otherwise fail every request.
        this.logger.warn(`Session "${sessionId}" payload is corrupt JSON; destroying it`);
        await this.removeSession(sessionId);
        return null;
      }
    } catch (error) {
      throw this.wrapError(`get failed for session "${sessionId}"`, error);
    }
  }

  async set(sessionId: string, session: unknown, options?: ISessionSetOptions): Promise<void> {
    this.assertSessionId(sessionId);
    const payload = this.serialize(sessionId, session);
    const userId = this.extractUserId(sessionId, session);
    const ttlMs = this.resolveTtlMs(options?.ttlMs);
    const now = Date.now();
    const cap = this.capMs();
    const maxSessions = this.options.maxSessionsPerUser;
    const rejectPolicy = this.options.maxSessionsPolicy === 'reject';
    // Best estimate before the write: clamped to the cap so a reject-policy
    // reservation can never outlive the session it reserves a seat for.
    const estimatedExpiresAt = now + (cap > 0 ? Math.min(ttlMs, cap) : ttlMs);

    try {
      let reserved = false;
      if (userId !== undefined && maxSessions !== undefined && rejectPolicy) {
        const [allowed] = (await this.reserve(this.userIndexKey(userId), sessionId, estimatedExpiresAt, now, maxSessions, true)) as number[];
        if (allowed !== 1) {
          this.countMetric('redisx_session_limit_rejections_total');
          throw new SessionLimitExceededError(userId, maxSessions);
        }
        reserved = true;
      }

      let result: Array<number | string>;
      try {
        result = (await this.runScript('set', this.sessionKeys(sessionId), [payload, ttlMs, now, userId ?? '', cap])) as Array<number | string>;
      } catch (error) {
        // Compensation: a reservation without a session must not burn a seat.
        if (reserved && userId !== undefined) {
          await this.driver.zrem(this.userIndexKey(userId), sessionId).catch((cleanupError: unknown) => {
            this.logger.warn(`Failed to release reserved seat for user "${userId}": ${(cleanupError as Error).message}`);
          });
        }
        throw error;
      }

      const status = result[0];
      if (status === -1) {
        await this.onCapExpired(sessionId, userId);
        return;
      }

      const expiresAt = (result[1] as number) ?? now + ttlMs;

      // Account switch on the same sid: leave no trace in the previous
      // owner's index (device-page leak + phantom seat otherwise).
      const prevUserId = this.asUserId(result[2]);
      if (prevUserId !== undefined && prevUserId !== userId) {
        await this.driver.zrem(this.userIndexKey(prevUserId), sessionId);
      }

      if (userId !== undefined) {
        const [, activeCount] = (await this.reserve(this.userIndexKey(userId), sessionId, expiresAt, now, rejectPolicy ? 0 : (maxSessions ?? 0), false)) as number[];
        if (!rejectPolicy && maxSessions !== undefined && (activeCount ?? 0) > maxSessions) {
          await this.evictOldest(userId, sessionId, (activeCount ?? 0) - maxSessions);
        }
      }
      await this.reserve(this.globalIndexKey(), sessionId, expiresAt, now, 0, 0);

      if (status === 1) {
        this.countMetric('redisx_session_created_total');
        this.emitEvent(this.events().onCreated, { sessionId, userId });
      }
    } catch (error) {
      throw this.wrapError(`set failed for session "${sessionId}"`, error);
    }
  }

  async touch(sessionId: string, options?: ISessionSetOptions): Promise<boolean> {
    this.assertSessionId(sessionId);
    const ttlMs = this.resolveTtlMs(options?.ttlMs);
    const now = Date.now();

    try {
      const result = (await this.runScript('touch', this.sessionKeys(sessionId), [ttlMs, now, this.capMs()])) as Array<number | string>;
      const status = result[0];

      if (status === -1) {
        await this.onCapExpired(sessionId, this.asUserId(result[1]));
        return false;
      }
      if (status !== 1) {
        return false;
      }

      const expiresAt = result[1] as number;
      const userId = this.asUserId(result[2]);
      if (userId !== undefined) {
        await this.reserve(this.userIndexKey(userId), sessionId, expiresAt, now, 0, 0);
      }
      await this.reserve(this.globalIndexKey(), sessionId, expiresAt, now, 0, 0);
      return true;
    } catch (error) {
      throw this.wrapError(`touch failed for session "${sessionId}"`, error);
    }
  }

  async destroy(sessionId: string, reason: SessionEndReason = 'destroyed'): Promise<boolean> {
    try {
      this.assertSessionId(sessionId);
      const { existed, userId } = await this.removeSession(sessionId);
      if (!existed) {
        return false;
      }

      this.countMetric('redisx_session_destroyed_total', { reason });
      this.emitEvent(this.eventFor(reason), { sessionId, userId });
      return true;
    } catch (error) {
      throw this.wrapError(`destroy failed for session "${sessionId}"`, error);
    }
  }

  async getMetadata(sessionId: string): Promise<ISessionMetadata | null> {
    try {
      this.assertSessionId(sessionId);
      const hash = await this.driver.hgetall(this.metaKey(sessionId));
      return parseSessionMetadata(hash);
    } catch (error) {
      throw this.wrapError(`getMetadata failed for session "${sessionId}"`, error);
    }
  }

  async recordActivity(sessionId: string, activity: ISessionActivity): Promise<void> {
    try {
      this.assertSessionId(sessionId);
      await this.runScript('activity', [this.metaKey(sessionId)], [Date.now(), activity.ip ?? '', activity.userAgent ?? '']);
    } catch (error) {
      throw this.wrapError(`recordActivity failed for session "${sessionId}"`, error);
    }
  }

  async getUserSessionIds(userId: string): Promise<string[]> {
    try {
      return (await this.runScript('range', [this.userIndexKey(userId)], [Date.now()])) as string[];
    } catch (error) {
      throw this.wrapError(`getUserSessionIds failed for user "${userId}"`, error);
    }
  }

  async count(): Promise<number> {
    try {
      return (await this.runScript('count', [this.globalIndexKey()], [Date.now()])) as number;
    } catch (error) {
      throw this.wrapError('count failed', error);
    }
  }

  async countByUser(userId: string): Promise<number> {
    try {
      return (await this.runScript('count', [this.userIndexKey(userId)], [Date.now()])) as number;
    } catch (error) {
      throw this.wrapError(`countByUser failed for user "${userId}"`, error);
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * An empty sid — or one starting with `}` — produces an EMPTY cluster hash
   * tag, which makes Redis hash the whole key: payload and metadata would land
   * on different slots and every multi-key script would fail with CROSSSLOT.
   */
  private assertSessionId(sessionId: string): void {
    if (sessionId.length === 0 || sessionId.startsWith('}')) {
      throw new SessionStoreError(`Invalid session id ${JSON.stringify(sessionId)}: it must be non-empty and must not start with "}"`);
    }
  }

  /** Payload + metadata keys share a hash tag -> same cluster slot. */
  private sessionKeys(sessionId: string): [string, string] {
    const tag = `${this.keyPrefix()}{${sessionId}}`;
    return [tag, `${tag}:meta`];
  }

  private metaKey(sessionId: string): string {
    return `${this.keyPrefix()}{${sessionId}}:meta`;
  }

  private userIndexKey(userId: string): string {
    return `${this.keyPrefix()}user:${userId}`;
  }

  private globalIndexKey(): string {
    return `${this.keyPrefix()}index`;
  }

  private keyPrefix(): string {
    return this.options.keyPrefix ?? DEFAULT_SESSION_CONFIG.keyPrefix;
  }

  private defaultTtlMs(): number {
    return this.options.defaultTtlMs ?? DEFAULT_SESSION_CONFIG.defaultTtlMs;
  }

  private capMs(): number {
    return this.options.absoluteLifetimeMs ?? 0;
  }

  private events(): ISessionEvents {
    return this.options.events ?? {};
  }

  /**
   * TTLs must be positive finite integers: PEXPIRE rejects anything else
   * mid-script AFTER the payload SET, which would leave a persisted,
   * uncappable session key behind (Redis does not roll scripts back).
   */
  private resolveTtlMs(ttlMs: number | undefined): number {
    const requested = ttlMs ?? this.defaultTtlMs();
    const resolved = Math.floor(requested);
    if (!Number.isFinite(resolved) || resolved < 1) {
      throw new SessionStoreError(`Invalid session TTL ${String(requested)}ms: expected a positive finite number of milliseconds`);
    }
    return resolved;
  }

  private serialize(sessionId: string, session: unknown): string {
    if (session === null || session === undefined) {
      // 'null' would round-trip as a permanent miss that still holds a seat.
      throw new SessionSerializationError(sessionId);
    }
    let payload: string | undefined;
    try {
      payload = JSON.stringify(session);
    } catch (error) {
      throw new SessionSerializationError(sessionId, error as Error);
    }
    if (payload === undefined) {
      throw new SessionSerializationError(sessionId);
    }
    return payload;
  }

  /**
   * Extractor results are normalized: only non-empty strings (and finite
   * numbers, stringified) count as a user identity — an empty string would
   * index sessions under `sess:user:` and orphan them forever.
   */
  private extractUserId(sessionId: string, session: unknown): string | undefined {
    const extractor = this.options.userIdExtractor ?? defaultUserIdExtractor;
    let raw: unknown;
    try {
      raw = extractor(session);
    } catch (error) {
      throw new SessionStoreError(`userIdExtractor failed for session "${sessionId}": ${(error as Error).message}`, error as Error);
    }
    if (typeof raw === 'string' && raw.length > 0) {
      return raw;
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return String(raw);
    }
    return undefined;
  }

  /** Index write/refresh — always via Lua (sweep + score + index-key TTL). */
  private reserve(indexKey: string, sessionId: string, expiresAt: number, now: number, max: number, reject: boolean): Promise<unknown> {
    return this.runScript('reserve', [indexKey], [sessionId, expiresAt, now, max, reject ? 1 : 0]);
  }

  /**
   * Destroy the oldest sessions (by createdAt) over the seat limit,
   * never touching the session being written. A session whose createdAt is
   * lost sorts first on purpose: it is a broken/phantom seat.
   */
  private async evictOldest(userId: string, keepSessionId: string, overBy: number): Promise<void> {
    const candidates = (await this.getUserSessionIds(userId)).filter((id) => id !== keepSessionId);
    if (candidates.length === 0 || overBy <= 0) {
      return;
    }

    const withCreatedAt = await Promise.all(
      candidates.map(async (id) => ({
        id,
        createdAt: Number((await this.driver.hget(this.metaKey(id), 'createdAt')) ?? 0),
      })),
    );
    withCreatedAt.sort((a, b) => a.createdAt - b.createdAt);

    for (const victim of withCreatedAt.slice(0, overBy)) {
      await this.destroy(victim.id, 'revoked');
    }
  }

  /** Remove payload+metadata and clean both index entries. */
  private async removeSession(sessionId: string): Promise<{ existed: boolean; userId?: string }> {
    const result = (await this.runScript('destroy', this.sessionKeys(sessionId), [])) as Array<number | string>;
    const existed = result[0] === 1;
    const userId = this.asUserId(result[1]);
    await this.cleanIndexes(sessionId, userId);
    return { existed, userId };
  }

  /** A session died from the absolute lifetime cap inside a script. */
  private async onCapExpired(sessionId: string, userId: string | undefined): Promise<void> {
    await this.cleanIndexes(sessionId, userId);
    this.countMetric('redisx_session_destroyed_total', { reason: 'expired-by-cap' });
    this.emitEvent(this.events().onExpiredByCap, { sessionId, userId });
  }

  private async cleanIndexes(sessionId: string, userId: string | undefined): Promise<void> {
    if (userId !== undefined) {
      await this.driver.zrem(this.userIndexKey(userId), sessionId);
    }
    await this.driver.zrem(this.globalIndexKey(), sessionId);
  }

  private eventFor(reason: SessionEndReason): ISessionEvents[keyof ISessionEvents] {
    const events = this.events();
    if (reason === 'revoked') {
      return events.onRevoked;
    }
    if (reason === 'expired-by-cap') {
      return events.onExpiredByCap;
    }
    return events.onDestroyed;
  }

  /** Fire-and-forget event dispatch: listener failures never break requests. */
  private emitEvent(callback: ((info: ISessionEventInfo) => void | Promise<void>) | undefined, info: ISessionEventInfo): void {
    if (!callback) {
      return;
    }
    try {
      Promise.resolve(callback(info)).catch((error: unknown) => {
        this.logger.warn(`Session event listener failed: ${(error as Error).message}`);
      });
    } catch (error) {
      this.logger.warn(`Session event listener failed: ${(error as Error).message}`);
    }
  }

  /** Metrics are observability — a broken metrics service must never fail a request. */
  private countMetric(name: string, labels?: Record<string, string>): void {
    try {
      if (labels) {
        this.metrics?.incrementCounter(name, labels);
      } else {
        this.metrics?.incrementCounter(name);
      }
    } catch (error) {
      this.logger.warn(`Metrics increment failed for "${name}": ${(error as Error).message}`);
    }
  }

  private asUserId(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  /**
   * Run a script via EVALSHA, falling back to EVAL on NOSCRIPT.
   */
  private async runScript(name: ScriptName, keys: string[], args: Array<string | number>): Promise<unknown> {
    const sha = this.shas.get(name);
    const script = SCRIPTS[name];
    try {
      if (sha) {
        return await this.driver.evalsha(sha, keys, args);
      }
      return await this.driver.eval(script, keys, args);
    } catch (error) {
      if (this.isNoScriptError(error)) {
        return this.driver.eval(script, keys, args);
      }
      throw error;
    }
  }

  private isNoScriptError(error: unknown): boolean {
    const message = (error as Error).message ?? '';
    return message.includes('NOSCRIPT') || message.includes('No matching script');
  }

  private wrapError(message: string, error: unknown): SessionError {
    if (error instanceof SessionError) {
      return error;
    }
    return new SessionStoreError(`${message}: ${(error as Error).message}`, error as Error);
  }
}
