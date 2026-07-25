import { BaseRedisDriver, type ConnectionConfig, type IPipeline, type IMulti, type ISetOptions, DriverEvent } from '@nestjs-redisx/core';

import { MemoryStore } from '../../domain/store/memory-store';
import { CommandExecutor } from '../../application/services/command-executor.service';
import { memoryPubSubBus, IMemoryPubSubSubscriber } from '../../domain/pubsub/memory-pubsub-bus';
import { ICommandExecutor } from '../../application/ports/command-executor.port';

/**
 * Buffers commands and replays them sequentially over the in-memory executor.
 * (Plugins use Lua, not pipelines, for atomicity — this exists for API parity.)
 */
class MemoryPipeline implements IPipeline {
  protected queue: Array<{ cmd: string; args: unknown[] }> = [];

  constructor(protected readonly executor: ICommandExecutor) {}

  protected enqueue(cmd: string, args: unknown[]): this {
    this.queue.push({ cmd, args });
    return this;
  }

  get(key: string): this {
    return this.enqueue('GET', [key]);
  }
  set(key: string, value: string, options?: ISetOptions): this {
    const args: unknown[] = [key, value];
    if (options?.ex !== undefined) args.push('EX', options.ex);
    if (options?.px !== undefined) args.push('PX', options.px);
    if (options?.nx) args.push('NX');
    if (options?.xx) args.push('XX');
    return this.enqueue('SET', args);
  }
  del(...keys: string[]): this {
    return this.enqueue('DEL', keys);
  }
  mget(...keys: string[]): this {
    return this.enqueue('MGET', keys);
  }
  mset(data: Record<string, string>): this {
    return this.enqueue('MSET', Object.entries(data).flat());
  }
  expire(key: string, seconds: number): this {
    return this.enqueue('EXPIRE', [key, seconds]);
  }
  ttl(key: string): this {
    return this.enqueue('TTL', [key]);
  }
  incr(key: string): this {
    return this.enqueue('INCR', [key]);
  }
  incrby(key: string, increment: number): this {
    return this.enqueue('INCRBY', [key, increment]);
  }
  hget(key: string, field: string): this {
    return this.enqueue('HGET', [key, field]);
  }
  hset(key: string, field: string, value: string): this {
    return this.enqueue('HSET', [key, field, value]);
  }
  hmset(key: string, data: Record<string, string>): this {
    return this.enqueue('HMSET', [key, ...Object.entries(data).flat()]);
  }
  hgetall(key: string): this {
    return this.enqueue('HGETALL', [key]);
  }
  lpush(key: string, ...values: string[]): this {
    return this.enqueue('LPUSH', [key, ...values]);
  }
  rpush(key: string, ...values: string[]): this {
    return this.enqueue('RPUSH', [key, ...values]);
  }
  sadd(key: string, ...members: string[]): this {
    return this.enqueue('SADD', [key, ...members]);
  }
  srem(key: string, ...members: string[]): this {
    return this.enqueue('SREM', [key, ...members]);
  }
  zadd(key: string, ...args: Array<number | string>): this {
    return this.enqueue('ZADD', [key, ...args]);
  }
  zrem(key: string, ...members: string[]): this {
    return this.enqueue('ZREM', [key, ...members]);
  }

  exec(): Promise<Array<[Error | null, unknown]>> {
    const results: Array<[Error | null, unknown]> = [];
    for (const { cmd, args } of this.queue) {
      try {
        results.push([null, this.executor.execute(cmd, args)]);
      } catch (error) {
        results.push([error as Error, null]);
      }
    }
    this.queue = [];
    return Promise.resolve(results);
  }
}

class MemoryMulti extends MemoryPipeline implements IMulti {
  discard(): void {
    this.queue = [];
  }
}

/**
 * In-memory `IRedisDriver` for tests. Implements the 5 `BaseRedisDriver`
 * abstract methods over an in-memory store + Lua interpreter; the other ~186
 * driver methods are inherited.
 */
export class MemoryRedisAdapter extends BaseRedisDriver {
  private readonly store: MemoryStore;
  private readonly executor: CommandExecutor;

  /** Bridges the module-global Pub/Sub bus to this adapter's driver events. */
  private readonly pubSubSubscriber: IMemoryPubSubSubscriber = {
    onMessage: (channel, message) => this.emit(DriverEvent.MESSAGE, channel, message),
    onPMessage: (pattern, channel, message) => this.emit(DriverEvent.PMESSAGE, pattern, channel, message),
  };

  constructor(config: ConnectionConfig, options?: { enableLogging?: boolean }) {
    super(config, options);
    this.store = new MemoryStore();
    this.executor = new CommandExecutor(this.store);
  }

  /**
   * Pub/Sub overrides: delivery spans ALL memory adapters in the process via a
   * shared bus (single-node semantics), so a plugin's dedicated subscriber
   * client receives messages published through any other client.
   */
  override publish(channel: string, message: string): Promise<number> {
    return Promise.resolve(memoryPubSubBus.publish(channel, message));
  }

  override subscribe(...channels: string[]): Promise<void> {
    for (const channel of channels) {
      memoryPubSubBus.subscribe(this.pubSubSubscriber, channel);
    }
    return Promise.resolve();
  }

  override unsubscribe(...channels: string[]): Promise<void> {
    memoryPubSubBus.unsubscribe(this.pubSubSubscriber, channels);
    return Promise.resolve();
  }

  override psubscribe(...patterns: string[]): Promise<void> {
    for (const pattern of patterns) {
      memoryPubSubBus.psubscribe(this.pubSubSubscriber, pattern);
    }
    return Promise.resolve();
  }

  override punsubscribe(...patterns: string[]): Promise<void> {
    memoryPubSubBus.punsubscribe(this.pubSubSubscriber, patterns);
    return Promise.resolve();
  }

  /** Exposes the backing store for assertions / manual reset in tests. */
  getStore(): MemoryStore {
    return this.store;
  }

  protected doConnect(): Promise<void> {
    // No real connection — in-memory.
    return Promise.resolve();
  }

  protected doDisconnect(): Promise<void> {
    // No real connection — keep data; a fresh adapter starts empty.
    memoryPubSubBus.removeSubscriber(this.pubSubSubscriber);
    return Promise.resolve();
  }

  protected async executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
    const result = this.executor.execute(command, args);

    // The in-memory driver never truly blocks, but a blocking XREAD/XREADGROUP
    // poll loop with no data would otherwise hot-spin on microtasks and starve
    // the event loop. When such a call comes back empty, yield with a short real
    // (macrotask) delay so producers and timers can run between polls.
    const cmd = command.toUpperCase();
    if (result === null && (cmd === 'XREADGROUP' || cmd === 'XREAD')) {
      const blockIdx = args.findIndex((a) => String(a).toUpperCase() === 'BLOCK');
      if (blockIdx !== -1) {
        const blockMs = Number(args[blockIdx + 1]);
        const delay = Number.isFinite(blockMs) && blockMs > 0 ? Math.min(blockMs, 20) : 20;
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }

    return result;
  }

  protected createPipeline(): IPipeline {
    return new MemoryPipeline(this.executor);
  }

  protected createMulti(): IMulti {
    return new MemoryMulti(this.executor);
  }
}
