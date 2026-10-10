/**
 * Inline Lua scripts for deduplication operations.
 *
 * Scripts are stored as inline strings to avoid issues with file reading
 * after build (dist directory doesn't contain .lua files).
 */

/**
 * Release a dedup marker only if owned by the token — the first-caller that
 * failed may re-open the window for a retry without erasing a marker a NEWER
 * first-caller has since set.
 *
 * KEYS[1] = marker key
 * ARGV[1] = owner token
 * Returns: 1 if released, 0 if not owned or already expired
 */
export const RELEASE_IF_OWNER_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`.trim();

/**
 * Claim a debounce slot: only the caller whose id is still the LAST one
 * recorded may execute, and claiming consumes the slot atomically.
 *
 * Distinguishes the two 0-claim causes: a MISSING slot means the round was
 * lost to expiry (process stalled past the grace period) — silently
 * conflating it with legitimate supersession hid lost executions.
 *
 * KEYS[1] = debounce last-call key
 * ARGV[1] = caller id
 * Returns: 1 claimed; 0 superseded by a newer caller; -1 slot expired/missing
 */
export const CLAIM_LAST_CALL_SCRIPT = `
local current = redis.call("get", KEYS[1])
if current == false then
  return -1
end
if current == ARGV[1] then
  redis.call("del", KEYS[1])
  return 1
end
return 0
`.trim();
