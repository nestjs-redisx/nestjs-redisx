/**
 * Inline Lua scripts for atomic circuit-breaker state transitions.
 *
 * Scripts are stored as inline strings to avoid issues with file reading after
 * build (dist directory doesn't contain .lua files).
 *
 * Semantics mirror the pure `CircuitBreakerState` one-to-one. The current time
 * (`now`, epoch ms) is supplied by the adapter via Date.now() and passed in
 * ARGV — the scripts NEVER read time themselves (exactly like sliding-window).
 *
 * State storage (per circuit, all keys share a hash tag => same cluster slot):
 *  KEYS[1] = state hash    -> fields: state ('open'|'half-open'; absent = closed),
 *                             opened_at, ho_succ
 *  KEYS[2] = failures ZSET -> score = failure timestamp ms (CLOSED window)
 *  KEYS[3] = probes ZSET   -> score = probe start timestamp ms (HALF_OPEN);
 *                             a probe with score <= now - probeTimeoutMs is
 *                             expired and its slot is reclaimed
 *
 * Shared ARGV:
 *  ARGV[1] = failureThreshold
 *  ARGV[2] = windowMs
 *  ARGV[3] = openDurationMs
 *  ARGV[4] = halfOpenMaxCalls
 *  ARGV[5] = successThreshold
 *  ARGV[6] = probeTimeoutMs
 *  ARGV[7] = now (epoch ms)
 *  ARGV[8] = unique member id (CAN_REQUEST: probe member; RECORD_FAILURE: failure member)
 *
 * State codes returned to the adapter: 0 = closed, 1 = open, 2 = half-open.
 */

/** Shared preamble: parse keys + config + now, compute idle TTL for state keys. */
const PREAMBLE = `
local sk = KEYS[1]
local fk = KEYS[2]
local pk = KEYS[3]
local failure_threshold = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local open_ms = tonumber(ARGV[3])
local half_max = tonumber(ARGV[4])
local success_threshold = tonumber(ARGV[5])
local probe_timeout_ms = tonumber(ARGV[6])
local now = tonumber(ARGV[7])
local ttl_ms = math.max(window_ms, open_ms) * 2 + 60000
`;

/**
 * CAN_REQUEST — apply the request rule (mutating) and return the decision.
 * ARGV[8] = unique probe member id (used when a half-open slot is granted).
 *
 * Returns: {allowed(0/1), stateCode, failuresInWindow, halfOpenSuccesses, halfOpenInFlight}
 */
export const CAN_REQUEST_SCRIPT = (
  PREAMBLE +
  `
local member = ARGV[8]
local state = redis.call('HGET', sk, 'state')

if state == 'open' then
  local opened_at = tonumber(redis.call('HGET', sk, 'opened_at')) or 0
  if now - opened_at >= open_ms then
    -- commit OPEN -> HALF_OPEN (fresh probe list)
    redis.call('HSET', sk, 'state', 'half-open', 'ho_succ', 0)
    redis.call('DEL', pk)
    redis.call('PEXPIRE', sk, ttl_ms)
    state = 'half-open'
  else
    return {0, 1, 0, 0, 0}
  end
end

if state == 'half-open' then
  -- reclaim expired probes (start time <= now - probeTimeoutMs)
  redis.call('ZREMRANGEBYSCORE', pk, '-inf', now - probe_timeout_ms)
  local inflight = redis.call('ZCARD', pk)
  local succ = tonumber(redis.call('HGET', sk, 'ho_succ')) or 0
  if inflight < half_max then
    redis.call('ZADD', pk, now, member)
    redis.call('PEXPIRE', pk, ttl_ms)
    redis.call('PEXPIRE', sk, ttl_ms)
    return {1, 2, 0, succ, inflight + 1}
  else
    return {0, 2, 0, succ, inflight}
  end
end

-- CLOSED (state nil or 'closed'): prune window and report the count
redis.call('ZREMRANGEBYSCORE', fk, '-inf', now - window_ms)
local cnt = redis.call('ZCARD', fk)
return {1, 0, cnt, 0, 0}
`
).trim();

/**
 * RECORD_SUCCESS — record a success (mutating) and return the snapshot.
 *
 * Returns: {stateCode, failuresInWindow, halfOpenSuccesses, halfOpenInFlight}
 */
export const RECORD_SUCCESS_SCRIPT = (
  PREAMBLE +
  `
local state = redis.call('HGET', sk, 'state')
if not state then state = 'closed' end

if state == 'closed' then
  redis.call('ZREMRANGEBYSCORE', fk, '-inf', now - window_ms)
  local cnt = redis.call('ZCARD', fk)
  return {0, cnt, 0, 0}
end

if state == 'open' then
  -- ignored: no permitted calls exist in OPEN
  return {1, 0, 0, 0}
end

-- HALF_OPEN: reclaim expired probes, then release the most recently started
-- in-flight slot, if any (a probe that outlived probeTimeoutMs already lost
-- its slot, but its outcome still counts toward closing).
redis.call('ZREMRANGEBYSCORE', pk, '-inf', now - probe_timeout_ms)
local newest = redis.call('ZRANGE', pk, -1, -1)
if #newest > 0 then
  redis.call('ZREM', pk, newest[1])
end
local succ = (tonumber(redis.call('HGET', sk, 'ho_succ')) or 0) + 1
if succ >= success_threshold then
  redis.call('DEL', sk)
  redis.call('DEL', fk)
  redis.call('DEL', pk)
  return {0, 0, 0, 0}
else
  redis.call('HSET', sk, 'ho_succ', succ)
  redis.call('PEXPIRE', sk, ttl_ms)
  return {2, 0, succ, redis.call('ZCARD', pk)}
end
`
).trim();

/**
 * RECORD_FAILURE — record a failure (mutating) and return the snapshot.
 * ARGV[8] = unique failure member id (CLOSED window entry).
 *
 * Returns: {stateCode, failuresInWindow, halfOpenSuccesses, halfOpenInFlight}
 */
export const RECORD_FAILURE_SCRIPT = (
  PREAMBLE +
  `
local member = ARGV[8]
local state = redis.call('HGET', sk, 'state')
if not state then state = 'closed' end

if state == 'open' then
  -- ignored: no permitted calls exist in OPEN
  return {1, 0, 0, 0}
end

if state == 'half-open' then
  -- a single probe failure reopens the breaker
  redis.call('HSET', sk, 'state', 'open', 'opened_at', now, 'ho_succ', 0)
  redis.call('DEL', fk)
  redis.call('DEL', pk)
  redis.call('PEXPIRE', sk, ttl_ms)
  return {1, 0, 0, 0}
end

-- CLOSED
redis.call('ZADD', fk, now, member)
redis.call('ZREMRANGEBYSCORE', fk, '-inf', now - window_ms)
local cnt = redis.call('ZCARD', fk)
if cnt >= failure_threshold then
  redis.call('HSET', sk, 'state', 'open', 'opened_at', now, 'ho_succ', 0)
  redis.call('DEL', fk)
  redis.call('DEL', pk)
  redis.call('PEXPIRE', sk, ttl_ms)
  return {1, 0, 0, 0}
end
redis.call('PEXPIRE', fk, ttl_ms)
return {0, cnt, 0, 0}
`
).trim();

/**
 * GET_STATE — read the committed state WITHOUT mutating it.
 * Does not flip OPEN -> HALF_OPEN and does not reclaim probes; counts use
 * exclusive lower bounds (strictly newer than the cutoff are IN).
 *
 * Returns: {stateCode, failuresInWindow, halfOpenSuccesses, halfOpenInFlight}
 */
export const GET_STATE_SCRIPT = (
  PREAMBLE +
  `
local state = redis.call('HGET', sk, 'state')
if not state then state = 'closed' end

if state == 'open' then
  return {1, 0, 0, 0}
end

if state == 'half-open' then
  local succ = tonumber(redis.call('HGET', sk, 'ho_succ')) or 0
  local inflight = redis.call('ZCOUNT', pk, '(' .. (now - probe_timeout_ms), '+inf')
  return {2, 0, succ, inflight}
end

-- CLOSED (non-mutating count)
local cnt = redis.call('ZCOUNT', fk, '(' .. (now - window_ms), '+inf')
return {0, cnt, 0, 0}
`
).trim();
