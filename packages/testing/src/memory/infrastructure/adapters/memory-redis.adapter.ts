import { BaseRedisDriver, type ConnectionConfig, type IPipeline, type IMulti, type ISetOptions } from '@nestjs-redisx/core';

import { MemoryStore } from '../../domain/store/memory-store';
import { CommandExecutor } from '../../application/services/command-executor.service';
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

  constructor(config: ConnectionConfig, options?: { enableLogging?: boolean }) {
    super(config, options);
    this.store = new MemoryStore();
    this.executor = new CommandExecutor(this.store);
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
    return Promise.resolve();
  }

  protected executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
    return Promise.resolve(this.executor.execute(command, args));
  }

  protected createPipeline(): IPipeline {
    return new MemoryPipeline(this.executor);
  }

  protected createMulti(): IMulti {
    return new MemoryMulti(this.executor);
  }
}
