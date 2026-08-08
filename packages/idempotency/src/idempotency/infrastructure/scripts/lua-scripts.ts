/**
 * Inline Lua scripts for idempotency operations.
 *
 * Scripts are stored as inline strings to avoid issues with file reading
 * after build (dist directory doesn't contain .lua files).
 */

/**
 * Check and Lock Lua script for idempotency
 *
 * This script atomically checks if an idempotency key exists and locks it if new.
 *
 * KEYS[1] = idempotency key
 * ARGV[1] = fingerprint
 * ARGV[2] = lock timeout (ms)
 * ARGV[3] = current timestamp (ms)
 * ARGV[4] = validate fingerprint flag ('1' = compare fingerprints, '0' = skip)
 *
 * Returns:
 * - ['new'] - new request, lock acquired
 * - ['fingerprint_mismatch'] - same key, different fingerprint
 * - ['processing'] - another request is processing
 * - [status, statusCode, response, headers, error] - completed/failed record
 */
export const CHECK_AND_LOCK_SCRIPT = `
local key = KEYS[1]
local fingerprint = ARGV[1]
local lock_timeout = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local validate = ARGV[4] ~= '0'

-- Check if key exists
local existing = redis.call('HGETALL', key)

if #existing == 0 then
  -- New request - create lock.
  -- The key is retained for 2x lock_timeout: the lock is considered STALE
  -- after lock_timeout (see the takeover branch below), but the record must
  -- still exist at that moment for the takeover to be atomic. With retention
  -- equal to the staleness threshold the key would already be expired and the
  -- branch would be dead code (takeover then degrades to a delete-then-race).
  redis.call('HMSET', key,
    'fingerprint', fingerprint,
    'status', 'processing',
    'startedAt', now
  )
  redis.call('PEXPIRE', key, lock_timeout * 2)
  return {'new'}
end

-- Convert to table
local record = {}
for i = 1, #existing, 2 do
  record[existing[i]] = existing[i + 1]
end

-- Check fingerprint (skipped when validateFingerprint is disabled)
if validate and record.fingerprint ~= fingerprint then
  return {'fingerprint_mismatch'}
end

-- Check status
if record.status == 'processing' then
  -- The lock is stale once the original attempt exceeded lock_timeout
  -- (presumed dead: it crashed between checkAndLock and complete). The key
  -- itself lives for 2x lock_timeout, so this takeover is ATOMIC: exactly one
  -- contender flips startedAt and wins; the rest keep seeing 'processing'.
  local started = tonumber(record.startedAt)
  if now - started > lock_timeout then
    redis.call('HMSET', key,
      'fingerprint', fingerprint,
      'status', 'processing',
      'startedAt', now
    )
    redis.call('PEXPIRE', key, lock_timeout * 2)
    return {'new'}
  end
  return {'processing'}
end

-- Completed or failed - return record
return {
  record.status,
  record.statusCode or '',
  record.response or '',
  record.headers or '',
  record.error or ''
}
`.trim();

/**
 * Atomically writes a completed/failed record: all hash fields AND the TTL in
 * one script. The previous implementation issued HMSET and EXPIRE as two
 * separate commands; a crash between them either left the response under the
 * leftover lock TTL (early expiry -> duplicate execution) or, when the record
 * had already expired mid-handler, re-created the key WITHOUT a TTL (immortal
 * record -> memory leak).
 *
 * KEYS[1] = idempotency key
 * ARGV[1] = ttl (ms)
 * ARGV[2..] = alternating field/value pairs
 *
 * Returns 1.
 */
export const STORE_RECORD_SCRIPT = `
local key = KEYS[1]
local ttl_ms = tonumber(ARGV[1])

for i = 2, #ARGV, 2 do
  redis.call('HSET', key, ARGV[i], ARGV[i + 1])
end
redis.call('PEXPIRE', key, ttl_ms)
return 1
`.trim();
