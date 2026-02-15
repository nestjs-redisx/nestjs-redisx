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

-- Check if key exists
local existing = redis.call('HGETALL', key)

if #existing == 0 then
  -- New request - create lock
  redis.call('HMSET', key,
    'fingerprint', fingerprint,
    'status', 'processing',
    'startedAt', now
  )
  redis.call('PEXPIRE', key, lock_timeout)
  return {'new'}
end

-- Convert to table
local record = {}
for i = 1, #existing, 2 do
  record[existing[i]] = existing[i + 1]
end

-- Check fingerprint
if record.fingerprint ~= fingerprint then
  return {'fingerprint_mismatch'}
end

-- Check status
if record.status == 'processing' then
  -- Check if lock expired (stale)
  local started = tonumber(record.startedAt)
  if now - started > lock_timeout then
    -- Stale lock - take over
    redis.call('HMSET', key,
      'status', 'processing',
      'startedAt', now
    )
    redis.call('PEXPIRE', key, lock_timeout)
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
