/**
 * Inline Lua scripts for lock operations.
 *
 * Scripts are stored as inline strings to avoid issues with file reading
 * after build (dist directory doesn't contain .lua files).
 */

/**
 * Release lock if owned by token.
 *
 * KEYS[1] = lock key
 * ARGV[1] = owner token
 * Returns: 1 if released, 0 if not owned or doesn't exist
 */
export const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`.trim();

/**
 * Extend lock TTL if owned by token.
 *
 * KEYS[1] = lock key
 * ARGV[1] = owner token
 * ARGV[2] = TTL in milliseconds
 * Returns: 1 if extended, 0 if not owned or doesn't exist
 */
export const EXTEND_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`.trim();
