/**
 * Inline Lua scripts for rate limiting operations.
 *
 * Scripts are stored as inline strings to avoid issues with file reading
 * after build (dist directory doesn't contain .lua files).
 */

/**
 * Fixed Window Lua script.
 *
 * KEYS[1] = rate limit key
 * ARGV[1] = max points
 * ARGV[2] = window duration (seconds)
 * ARGV[3] = current timestamp
 *
 * Returns: {allowed, remaining, reset, current}
 */
export const FIXED_WINDOW_SCRIPT = `
local key = KEYS[1]
local max_points = tonumber(ARGV[1])
local duration = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local window = math.floor(now / duration) * duration
local window_key = '{' .. key .. '}:' .. window

local current = redis.call('INCR', window_key)

if current == 1 then
  redis.call('EXPIRE', window_key, duration)
end

local allowed = current <= max_points
local remaining = math.max(0, max_points - current)
local reset = window + duration

return {allowed and 1 or 0, remaining, reset, current}
`.trim();

/**
 * Sliding Window Log Lua script.
 *
 * KEYS[1] = rate limit key
 * ARGV[1] = max points
 * ARGV[2] = window duration (seconds)
 * ARGV[3] = current timestamp (ms)
 * ARGV[4] = unique request id
 *
 * Returns: {allowed, remaining, reset, current, retryAfter?}
 */
export const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local max_points = tonumber(ARGV[1])
local duration = tonumber(ARGV[2]) * 1000  -- Convert to ms
local now = tonumber(ARGV[3])
local request_id = ARGV[4]

local window_start = now - duration

-- Remove expired entries
redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

-- Count current requests
local current = redis.call('ZCARD', key)

if current < max_points then
  -- Add new request
  redis.call('ZADD', key, now, request_id)
  redis.call('PEXPIRE', key, duration)

  return {1, max_points - current - 1, math.ceil((now + duration) / 1000), current + 1}
else
  -- Get oldest entry to calculate retry time
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry_after = 0
  if #oldest > 0 then
    retry_after = math.ceil((tonumber(oldest[2]) + duration - now) / 1000)
  end

  return {0, 0, math.ceil((now + duration) / 1000), current, retry_after}
end
`.trim();

/**
 * Token Bucket Lua script.
 *
 * KEYS[1] = rate limit key
 * ARGV[1] = bucket capacity
 * ARGV[2] = refill rate (tokens per second)
 * ARGV[3] = current timestamp (ms)
 * ARGV[4] = tokens to consume (default: 1)
 *
 * Returns: {allowed, remaining, reset, current, retryAfter?}
 */
export const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local consume = tonumber(ARGV[4]) or 1

-- Get current state
local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(bucket[1]) or capacity
local last_refill = tonumber(bucket[2]) or now

-- Calculate refill
local elapsed = (now - last_refill) / 1000  -- Convert to seconds
local refill = elapsed * refill_rate
tokens = math.min(capacity, tokens + refill)

-- Try to consume
local allowed = tokens >= consume
local new_tokens = tokens

if allowed then
  new_tokens = tokens - consume
end

-- Save state
redis.call('HMSET', key, 'tokens', new_tokens, 'last_refill', now)
redis.call('PEXPIRE', key, math.ceil(capacity / refill_rate * 1000) + 1000)

local retry_after = 0
if not allowed then
  retry_after = math.ceil((consume - new_tokens) / refill_rate)
end

-- Calculate reset time (when bucket will be full again)
local time_to_full = (capacity - new_tokens) / refill_rate
local reset = math.ceil(now / 1000 + time_to_full)

return {allowed and 1 or 0, math.floor(new_tokens), reset, math.floor(tokens), retry_after}
`.trim();
