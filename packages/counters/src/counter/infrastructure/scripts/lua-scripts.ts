/**
 * Inline Lua scripts for counter operations.
 *
 * Scripts are stored as inline strings to avoid issues with file reading
 * after build (dist directory doesn't contain .lua files).
 */

/**
 * Increment with a first-write window TTL: the TTL is applied only when
 * this mutation CREATES the key (EXISTS check — NOT a PTTL probe, which
 * would retrofit a window onto a pre-existing permanent counter). Later
 * mutations never extend the window: the idiomatic daily/hourly counter.
 *
 * KEYS[1] = counter key
 * ARGV[1] = amount (signed integer)
 * ARGV[2] = window TTL in milliseconds
 * Returns: the new value
 */
export const INCRBY_WITH_WINDOW_SCRIPT = `
local created = redis.call("exists", KEYS[1]) == 0
local value = redis.call("incrby", KEYS[1], ARGV[1])
if created then
  redis.call("pexpire", KEYS[1], ARGV[2])
end
return value
`.trim();

/**
 * Atomically read and delete a counter (flush-style consumption).
 *
 * Evidence-preserving: a value that is not numeric AT ALL is returned
 * WITHOUT deleting the key — destroying a poisoned value before anyone can
 * inspect it would turn the loud CounterValueError into an unprovable
 * mystery. (Numeric-looking garbage such as float strings still passes
 * tonumber and is consumed; the adapter's strict integer parse rejects it
 * loudly afterwards.)
 *
 * KEYS[1] = counter key
 * Returns: the value before deletion (0 when the key did not exist)
 */
export const GET_AND_RESET_SCRIPT = `
local value = redis.call("get", KEYS[1])
if value == false then
  return "0"
end
if not tonumber(value) then
  return value
end
redis.call("del", KEYS[1])
return value
`.trim();

/**
 * Set an absolute value while PRESERVING any existing TTL.
 *
 * A plain SET silently drops the key's TTL — correcting a window counter
 * mid-window (`set('daily', 0)`) would make it permanent, and every later
 * windowed increment would see EXISTS=1 and never re-arm the window: the
 * "daily" counter never resets again. (SET KEEPTTL exists on real Redis,
 * but the Lua form also runs on the in-memory driver.)
 *
 * KEYS[1] = counter key
 * ARGV[1] = value
 */
export const SET_KEEP_TTL_SCRIPT = `
local ttl = redis.call("pttl", KEYS[1])
redis.call("set", KEYS[1], ARGV[1])
if ttl > 0 then
  redis.call("pexpire", KEYS[1], ttl)
end
return 1
`.trim();
