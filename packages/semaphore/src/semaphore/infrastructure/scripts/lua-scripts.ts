/**
 * Inline Lua scripts for semaphore operations.
 *
 * Scripts are stored as inline strings to avoid issues with file reading
 * after build (dist directory doesn't contain .lua files).
 *
 * A semaphore is a single sorted set: member = permit id, score = permit
 * expiry (ms epoch). Expired members are swept inside the acquire script, so
 * crashed holders free their seats after their TTL with no background job.
 * One key per semaphore — cluster-safe without hash tags. Time comes in via
 * ARGV (never Lua clocks): scripts stay deterministic and replica-safe, and
 * the in-memory testing driver runs them byte-for-byte.
 *
 * No ZADD flags (XX/NX/GT) are used — existence is checked explicitly inside
 * the atomic script, which also keeps the scripts runnable on the in-memory
 * Lua interpreter.
 */

/**
 * Acquire a permit if capacity allows.
 *
 * KEYS[1] = semaphore key (sorted set)
 * ARGV[1] = permit id
 * ARGV[2] = capacity (max concurrent permits)
 * ARGV[3] = now (ms epoch)
 * ARGV[4] = ttl (ms)
 * Returns: 1 if acquired, 0 if the semaphore is full
 */
export const ACQUIRE_PERMIT_SCRIPT = `
redis.call("zremrangebyscore", KEYS[1], "-inf", ARGV[3])
local held = redis.call("zcard", KEYS[1])
if held < tonumber(ARGV[2]) then
  redis.call("zadd", KEYS[1], tonumber(ARGV[3]) + tonumber(ARGV[4]), ARGV[1])
  local kttl = redis.call("pttl", KEYS[1])
  if kttl < tonumber(ARGV[4]) then
    redis.call("pexpire", KEYS[1], ARGV[4])
  end
  return 1
end
return 0
`.trim();

/**
 * Release a permit (idempotent).
 *
 * KEYS[1] = semaphore key
 * ARGV[1] = permit id
 * Returns: 1 if the permit was held and removed, 0 otherwise
 */
export const RELEASE_PERMIT_SCRIPT = `
return redis.call("zrem", KEYS[1], ARGV[1])
`.trim();

/**
 * Extend a permit's TTL if it is still held (unexpired).
 *
 * KEYS[1] = semaphore key
 * ARGV[1] = permit id
 * ARGV[2] = now (ms epoch)
 * ARGV[3] = ttl (ms)
 * Returns: 1 if extended, 0 if the permit expired or was released
 */
export const EXTEND_PERMIT_SCRIPT = `
local score = redis.call("zscore", KEYS[1], ARGV[1])
if score and tonumber(score) > tonumber(ARGV[2]) then
  redis.call("zadd", KEYS[1], tonumber(ARGV[2]) + tonumber(ARGV[3]), ARGV[1])
  local kttl = redis.call("pttl", KEYS[1])
  if kttl < tonumber(ARGV[3]) then
    redis.call("pexpire", KEYS[1], ARGV[3])
  end
  return 1
end
return 0
`.trim();

/**
 * Count currently held (unexpired) permits.
 *
 * KEYS[1] = semaphore key
 * ARGV[1] = now (ms epoch)
 * Returns: number of live permits
 */
export const USED_PERMITS_SCRIPT = `
redis.call("zremrangebyscore", KEYS[1], "-inf", ARGV[1])
return redis.call("zcard", KEYS[1])
`.trim();

/**
 * Force-release every permit (admin operation).
 *
 * KEYS[1] = semaphore key
 * Returns: number of permits that were held
 */
export const FORCE_RELEASE_ALL_SCRIPT = `
local held = redis.call("zcard", KEYS[1])
redis.call("del", KEYS[1])
return held
`.trim();
