import { describe, it, expect } from 'vitest';
import { CAN_REQUEST_SCRIPT, RECORD_SUCCESS_SCRIPT, RECORD_FAILURE_SCRIPT, GET_STATE_SCRIPT } from '../../src/circuit-breaker/infrastructure/scripts/lua-scripts';

/**
 * Structural invariants of the Lua scripts. Behaviour is covered end-to-end by
 * the memory-driver and live-Redis integration suites; these tests pin the
 * contract-critical properties of the script text itself.
 */
describe('circuit breaker Lua scripts', () => {
  const ALL = [CAN_REQUEST_SCRIPT, RECORD_SUCCESS_SCRIPT, RECORD_FAILURE_SCRIPT, GET_STATE_SCRIPT];

  it('never read time inside Lua — now always comes from ARGV', () => {
    for (const script of ALL) {
      expect(script).not.toContain("redis.call('TIME')");
      expect(script).toContain('tonumber(ARGV[7])'); // now
    }
  });

  it('parse all six config knobs from ARGV', () => {
    for (const script of ALL) {
      for (const idx of [1, 2, 3, 4, 5, 6]) {
        expect(script).toContain(`ARGV[${idx}]`);
      }
    }
  });

  it('idle TTL accounts for window, cooldown AND probe timeout', () => {
    for (const script of ALL) {
      expect(script).toContain('math.max(window_ms, open_ms, probe_timeout_ms) * 2 + 60000');
    }
  });

  it('mutating scripts reclaim expired probes; getState counts non-mutating', () => {
    // canRequest / recordSuccess reclaim via ZREMRANGEBYSCORE on the probes key
    expect(CAN_REQUEST_SCRIPT).toContain("ZREMRANGEBYSCORE', pk, '-inf', now - probe_timeout_ms");
    expect(RECORD_SUCCESS_SCRIPT).toContain("ZREMRANGEBYSCORE', pk, '-inf', now - probe_timeout_ms");
    // getState must NOT mutate: exclusive-bound ZCOUNT, no removals
    expect(GET_STATE_SCRIPT).toContain("ZCOUNT', pk");
    expect(GET_STATE_SCRIPT).not.toContain('ZREMRANGEBYSCORE');
    expect(GET_STATE_SCRIPT).not.toContain('ZADD');
    expect(GET_STATE_SCRIPT).not.toContain('HSET');
  });

  it('recordSuccess releases the highest-score probe (ZRANGE -1 -1 + ZREM)', () => {
    expect(RECORD_SUCCESS_SCRIPT).toContain("ZRANGE', pk, -1, -1");
    expect(RECORD_SUCCESS_SCRIPT).toContain("ZREM', pk");
  });

  it('OPEN -> HALF_OPEN is committed only in canRequest', () => {
    expect(CAN_REQUEST_SCRIPT).toContain("'half-open'");
    expect(GET_STATE_SCRIPT).not.toContain("HSET', sk, 'state', 'half-open'");
  });
});
