/**
 * Inline Lua scripts for the session store.
 *
 * Conventions (shared with the other plugins):
 * - Scripts NEVER read the clock — `now` always arrives via ARGV.
 * - The payload key and metadata key share a hash tag (`{prefix+sid}` /
 *   `{prefix+sid}:meta`), so multi-key scripts stay on one cluster slot.
 * - Index scripts (`reserve`, `count`, `range`) touch exactly ONE key each —
 *   cluster-safe without hash tags.
 * - The `-- session:<name>` marker comment identifies each script (used by
 *   unit tests to route mocked EVALSHA calls); keep it on the first line.
 * - Language subset only (no cjson/pairs/while/string lib): the scripts must
 *   run on the @nestjs-redisx/testing memory Lua interpreter as-is.
 */

/**
 * Write a session payload + metadata atomically.
 *
 * KEYS[1] payload, KEYS[2] metadata
 * ARGV: payload JSON, ttlMs, nowMs, userId ('' = anonymous), capMs (0 = off)
 *
 * Returns `{created(0|1), expiresAt}`, or `{-1}` when the absolute lifetime
 * cap is already exhausted (the session is destroyed instead of written).
 */
export const SET_SESSION_SCRIPT = `
-- session:set
local now = tonumber(ARGV[3])
local ttl = tonumber(ARGV[2])
local cap = tonumber(ARGV[5])
local created = 0
if redis.call('EXISTS', KEYS[1]) == 0 then
  created = 1
end
local createdAt = tonumber(redis.call('HGET', KEYS[2], 'createdAt')) or now
if cap > 0 then
  local remaining = cap - (now - createdAt)
  if remaining <= 0 then
    redis.call('DEL', KEYS[1], KEYS[2])
    return {-1}
  end
  if remaining < ttl then
    ttl = remaining
  end
end
local expiresAt = now + ttl
redis.call('SET', KEYS[1], ARGV[1])
redis.call('PEXPIRE', KEYS[1], ttl)
redis.call('HSET', KEYS[2], 'createdAt', createdAt, 'lastSeenAt', now, 'expiresAt', expiresAt, 'userId', ARGV[4])
redis.call('PEXPIRE', KEYS[2], ttl)
return {created, expiresAt}
`.trim();

/**
 * Read a session payload, enforcing the absolute lifetime cap.
 *
 * KEYS[1] payload, KEYS[2] metadata
 * ARGV: nowMs, capMs (0 = off)
 *
 * Returns `{1, payload, userId}` on hit, `{0}` on miss, or `{-1, userId}`
 * when the cap expired the session (it is destroyed).
 */
export const GET_SESSION_SCRIPT = `
-- session:get
local payload = redis.call('GET', KEYS[1])
if payload == false then
  return {0}
end
local userId = redis.call('HGET', KEYS[2], 'userId')
if userId == false then
  userId = ''
end
local cap = tonumber(ARGV[2])
if cap > 0 then
  local createdAt = tonumber(redis.call('HGET', KEYS[2], 'createdAt')) or tonumber(ARGV[1])
  if tonumber(ARGV[1]) - createdAt >= cap then
    redis.call('DEL', KEYS[1], KEYS[2])
    return {-1, userId}
  end
end
return {1, payload, userId}
`.trim();

/**
 * Slide the TTL (rolling sessions), refresh `lastSeenAt`, enforce the cap.
 *
 * KEYS[1] payload, KEYS[2] metadata
 * ARGV: ttlMs, nowMs, capMs (0 = off)
 *
 * Returns `{1, expiresAt, userId}` on success, `{0}` on miss, or
 * `{-1, userId}` when the cap expired the session (it is destroyed).
 */
export const TOUCH_SESSION_SCRIPT = `
-- session:touch
if redis.call('EXISTS', KEYS[1]) == 0 then
  return {0}
end
local now = tonumber(ARGV[2])
local ttl = tonumber(ARGV[1])
local cap = tonumber(ARGV[3])
local createdAt = tonumber(redis.call('HGET', KEYS[2], 'createdAt')) or now
local userId = redis.call('HGET', KEYS[2], 'userId')
if userId == false then
  userId = ''
end
if cap > 0 then
  local remaining = cap - (now - createdAt)
  if remaining <= 0 then
    redis.call('DEL', KEYS[1], KEYS[2])
    return {-1, userId}
  end
  if remaining < ttl then
    ttl = remaining
  end
end
local expiresAt = now + ttl
redis.call('PEXPIRE', KEYS[1], ttl)
redis.call('HSET', KEYS[2], 'lastSeenAt', now, 'expiresAt', expiresAt)
redis.call('PEXPIRE', KEYS[2], ttl)
return {1, expiresAt, userId}
`.trim();

/**
 * Destroy a session (payload + metadata), reporting its owner.
 *
 * KEYS[1] payload, KEYS[2] metadata
 *
 * Returns `{existed(0|1), userId}`.
 */
export const DESTROY_SESSION_SCRIPT = `
-- session:destroy
local existed = redis.call('EXISTS', KEYS[1])
local userId = redis.call('HGET', KEYS[2], 'userId')
if userId == false then
  userId = ''
end
redis.call('DEL', KEYS[1], KEYS[2])
if existed == 1 then
  return {1, userId}
end
return {0, ''}
`.trim();

/**
 * Reserve a per-user session slot: sweep expired entries, enforce the seat
 * limit under the reject policy, index the session, and keep the index TTL
 * at least as long as its longest-lived member.
 *
 * KEYS[1] user index (ZSET sid -> expiresAtMs)
 * ARGV: sid, expiresAtMs, nowMs, max (0 = unlimited), rejectFlag (1 = reject at limit)
 *
 * Returns `{0, activeCount}` when rejected, `{1, activeCount}` when indexed.
 */
export const RESERVE_USER_SLOT_SCRIPT = `
-- session:reserve
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[3])
local isMember = redis.call('ZSCORE', KEYS[1], ARGV[1])
local max = tonumber(ARGV[4])
local reject = tonumber(ARGV[5])
if max > 0 then
  if reject == 1 then
    if not isMember then
      local size = redis.call('ZCARD', KEYS[1])
      if size >= max then
        return {0, size}
      end
    end
  end
end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
local ttl = tonumber(ARGV[2]) - tonumber(ARGV[3])
if ttl > 0 and redis.call('PTTL', KEYS[1]) < ttl then
  redis.call('PEXPIRE', KEYS[1], ttl)
end
return {1, redis.call('ZCARD', KEYS[1])}
`.trim();

/**
 * Count live index entries after sweeping expired scores.
 *
 * KEYS[1] index (ZSET sid -> expiresAtMs)
 * ARGV: nowMs
 */
export const COUNT_INDEX_SCRIPT = `
-- session:count
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
return redis.call('ZCARD', KEYS[1])
`.trim();

/**
 * List live index members after sweeping expired scores.
 *
 * KEYS[1] index (ZSET sid -> expiresAtMs)
 * ARGV: nowMs
 */
export const RANGE_INDEX_SCRIPT = `
-- session:range
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
return redis.call('ZRANGE', KEYS[1], 0, -1)
`.trim();

/**
 * Stamp activity attributes onto session metadata (only when it exists).
 *
 * KEYS[1] metadata
 * ARGV: nowMs, ip ('' = keep), userAgent ('' = keep)
 *
 * Returns 1 when stamped, 0 when the session is gone.
 */
export const RECORD_ACTIVITY_SCRIPT = `
-- session:activity
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 0
end
if ARGV[2] ~= '' then
  redis.call('HSET', KEYS[1], 'ip', ARGV[2])
end
if ARGV[3] ~= '' then
  redis.call('HSET', KEYS[1], 'userAgent', ARGV[3])
end
redis.call('HSET', KEYS[1], 'lastSeenAt', ARGV[1])
return 1
`.trim();
