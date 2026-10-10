/**
 * Inline Lua scripts for counter operations.
 *
 * Scripts are stored as inline strings to avoid issues with file reading
 * after build (dist directory doesn't contain .lua files).
 */

/**
 * Increment with a first-write window TTL: the TTL is applied only when the
 * key has none (i.e. this mutation created the window) — later mutations
 * never extend it, which is the idiomatic daily/hourly counter.
 *
 * KEYS[1] = counter key
 * ARGV[1] = amount (signed integer)
 * ARGV[2] = window TTL in milliseconds
 * Returns: the new value
 */
export const INCRBY_WITH_WINDOW_SCRIPT = `
local value = redis.call("incrby", KEYS[1], ARGV[1])
if redis.call("pttl", KEYS[1]) < 0 then
  redis.call("pexpire", KEYS[1], ARGV[2])
end
return value
`.trim();

/**
 * Atomically read and delete a counter (flush-style consumption).
 *
 * KEYS[1] = counter key
 * Returns: the value before deletion (0 when the key did not exist)
 */
export const GET_AND_RESET_SCRIPT = `
local value = redis.call("get", KEYS[1])
if value then
  redis.call("del", KEYS[1])
  return value
end
return "0"
`.trim();
