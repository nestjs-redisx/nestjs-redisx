/**
 * Inline Lua scripts for leader election.
 *
 * Scripts are stored as inline strings to avoid issues with file reading
 * after build (dist directory doesn't contain .lua files). Both scripts are
 * single-key (cluster-safe without hash tags) and use the
 * `if x == ARGV[1] then` idiom that the in-memory Lua interpreter supports.
 */

/**
 * Renew the lease only while this instance still holds it (CAS).
 *
 * KEYS[1] = election key
 * ARGV[1] = instance id
 * ARGV[2] = ttl in milliseconds
 *
 * Returns: 1 when extended, 0 when the key is gone or held by someone else.
 */
export const RENEW_LEADER_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`.trim();

/**
 * Release the lease only while this instance holds it (CAS delete).
 *
 * KEYS[1] = election key
 * ARGV[1] = instance id
 *
 * Returns: 1 when deleted, 0 otherwise.
 */
export const RELEASE_LEADER_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`.trim();
