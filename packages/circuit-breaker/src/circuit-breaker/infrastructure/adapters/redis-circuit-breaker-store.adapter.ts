import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { IRedisDriver } from '@nestjs-redisx/core';

import { CIRCUIT_BREAKER_REDIS_DRIVER } from '../../../shared/constants';
import { CircuitBreakerStoreError } from '../../../shared/errors';
import { CircuitState, ICircuitBreakerConfig, ICircuitSnapshot } from '../../domain/circuit-breaker-state.interface';
import { ICircuitBreakerStore } from '../../application/ports/circuit-breaker-store.port';
import { ICircuitBreakerDecision } from '../../../shared/types';
import { CAN_REQUEST_SCRIPT, GET_STATE_SCRIPT, RECORD_FAILURE_SCRIPT, RECORD_SUCCESS_SCRIPT } from '../scripts/lua-scripts';

/**
 * Redis-based circuit breaker state store.
 * Uses inline Lua scripts for atomic state transitions.
 *
 * Time is obtained here via Date.now() and passed into the scripts as ARGV —
 * the Lua never reads time itself (mirrors the rate-limit sliding-window store).
 */
@Injectable()
export class RedisCircuitBreakerStoreAdapter implements ICircuitBreakerStore, OnModuleInit {
  private canRequestSha: string | null = null;
  private recordSuccessSha: string | null = null;
  private recordFailureSha: string | null = null;
  private getStateSha: string | null = null;

  constructor(@Inject(CIRCUIT_BREAKER_REDIS_DRIVER) private readonly driver: IRedisDriver) {}

  /**
   * Pre-load Lua scripts on module initialization.
   */
  async onModuleInit(): Promise<void> {
    try {
      this.canRequestSha = await this.driver.scriptLoad(CAN_REQUEST_SCRIPT);
      this.recordSuccessSha = await this.driver.scriptLoad(RECORD_SUCCESS_SCRIPT);
      this.recordFailureSha = await this.driver.scriptLoad(RECORD_FAILURE_SCRIPT);
      this.getStateSha = await this.driver.scriptLoad(GET_STATE_SCRIPT);
    } catch (error) {
      throw new CircuitBreakerStoreError(`Failed to load Lua scripts: ${(error as Error).message}`, error as Error);
    }
  }

  async canRequest(key: string, config: ICircuitBreakerConfig): Promise<ICircuitBreakerDecision> {
    const now = Date.now(); // ⚠ real time — supplied to Lua as ARGV, never read inside Lua
    const keys = this.buildKeys(key);
    const args = [...this.buildConfigArgs(config), now];

    try {
      const result = await this.runScript(this.canRequestSha, CAN_REQUEST_SCRIPT, keys, args);
      return this.parseDecision(result);
    } catch (error) {
      throw new CircuitBreakerStoreError(`canRequest failed: ${(error as Error).message}`, error as Error);
    }
  }

  async recordSuccess(key: string, config: ICircuitBreakerConfig): Promise<ICircuitSnapshot> {
    const now = Date.now(); // ⚠ real time
    const keys = this.buildKeys(key);
    const args = [...this.buildConfigArgs(config), now];

    try {
      const result = await this.runScript(this.recordSuccessSha, RECORD_SUCCESS_SCRIPT, keys, args);
      return this.parseSnapshot(result);
    } catch (error) {
      throw new CircuitBreakerStoreError(`recordSuccess failed: ${(error as Error).message}`, error as Error);
    }
  }

  async recordFailure(key: string, config: ICircuitBreakerConfig): Promise<ICircuitSnapshot> {
    const now = Date.now(); // ⚠ real time
    const member = `${now}-${Math.random().toString(36).substring(7)}`; // ⚠ real time + random (unique ZSET member)
    const keys = this.buildKeys(key);
    const args = [...this.buildConfigArgs(config), now, member];

    try {
      const result = await this.runScript(this.recordFailureSha, RECORD_FAILURE_SCRIPT, keys, args);
      return this.parseSnapshot(result);
    } catch (error) {
      throw new CircuitBreakerStoreError(`recordFailure failed: ${(error as Error).message}`, error as Error);
    }
  }

  async getState(key: string, config: ICircuitBreakerConfig): Promise<ICircuitSnapshot> {
    const now = Date.now(); // ⚠ real time
    const keys = this.buildKeys(key);
    const args = [...this.buildConfigArgs(config), now];

    try {
      const result = await this.runScript(this.getStateSha, GET_STATE_SCRIPT, keys, args);
      return this.parseSnapshot(result);
    } catch (error) {
      throw new CircuitBreakerStoreError(`getState failed: ${(error as Error).message}`, error as Error);
    }
  }

  async reset(key: string): Promise<void> {
    const [stateKey, failKey] = this.buildKeys(key);

    try {
      // Single variadic DEL: both keys share a hash tag (same cluster slot),
      // so the circuit state and its failure window are cleared atomically.
      await this.driver.del(stateKey, failKey);
    } catch (error) {
      throw new CircuitBreakerStoreError(`reset failed: ${(error as Error).message}`, error as Error);
    }
  }

  /**
   * Build the two Redis keys sharing a hash tag so they land on the same
   * cluster slot: `{prefixedKey}` (state hash) and `{prefixedKey}:f` (failures).
   */
  private buildKeys(key: string): [string, string] {
    const tag = `{${key}}`;
    return [tag, `${tag}:f`];
  }

  private buildConfigArgs(config: ICircuitBreakerConfig): number[] {
    return [config.failureThreshold, config.windowMs, config.openDurationMs, config.halfOpenMaxCalls, config.successThreshold];
  }

  /**
   * Run a script via EVALSHA, falling back to EVAL on NOSCRIPT.
   */
  private async runScript(sha: string | null, script: string, keys: string[], args: Array<string | number>): Promise<number[]> {
    try {
      if (sha) {
        return (await this.driver.evalsha(sha, keys, args)) as number[];
      }
      return (await this.driver.eval(script, keys, args)) as number[];
    } catch (error) {
      if (this.isNoScriptError(error)) {
        return (await this.driver.eval(script, keys, args)) as number[];
      }
      throw error;
    }
  }

  private parseDecision(result: number[]): ICircuitBreakerDecision {
    const allowed = (result[0] ?? 0) === 1;
    return {
      allowed,
      snapshot: {
        state: this.toState(result[1] ?? 0),
        failuresInWindow: result[2] ?? 0,
        halfOpenSuccesses: result[3] ?? 0,
        halfOpenInFlight: result[4] ?? 0,
      },
    };
  }

  private parseSnapshot(result: number[]): ICircuitSnapshot {
    return {
      state: this.toState(result[0] ?? 0),
      failuresInWindow: result[1] ?? 0,
      halfOpenSuccesses: result[2] ?? 0,
      halfOpenInFlight: result[3] ?? 0,
    };
  }

  private toState(code: number): CircuitState {
    if (code === 1) {
      return 'open';
    }
    if (code === 2) {
      return 'half-open';
    }
    return 'closed';
  }

  private isNoScriptError(error: unknown): boolean {
    const message = (error as Error).message ?? '';
    return message.includes('NOSCRIPT') || message.includes('No matching script');
  }
}
