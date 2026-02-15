/**
 * Inline Lua scripts for tag-based cache invalidation.
 *
 * Scripts are stored as inline strings to avoid issues with file reading
 * after build (dist directory doesn't contain .lua files).
 */

/**
 * Atomically adds a cache key to multiple tag sets.
 *
 * KEYS[1..N] = tag set keys
 * ARGV[1] = cache key to add
 * ARGV[2] = TTL for tag sets in seconds
 *
 * Returns: number of tag sets updated
 */
export const ADD_KEY_TO_TAGS_SCRIPT = `
local cache_key = ARGV[1]
local tag_ttl = tonumber(ARGV[2])

for i = 1, #KEYS do
  local tag_key = KEYS[i]
  redis.call('SADD', tag_key, cache_key)
  redis.call('EXPIRE', tag_key, tag_ttl)
end

return #KEYS
`.trim();

/**
 * Atomically invalidates all cache keys for a tag.
 *
 * KEYS[1] = tag set key (e.g., "cache:_tag:users")
 *
 * Returns: number of deleted cache keys
 */
export const INVALIDATE_TAG_SCRIPT = `
local tag_key = KEYS[1]

-- Get all cache keys for this tag
local cache_keys = redis.call('SMEMBERS', tag_key)

if #cache_keys == 0 then
  -- Delete empty tag set and return 0
  redis.call('DEL', tag_key)
  return 0
end

-- Delete all cache keys
local deleted = 0
for i = 1, #cache_keys do
  local result = redis.call('DEL', cache_keys[i])
  deleted = deleted + result
end

-- Delete the tag set itself
redis.call('DEL', tag_key)

return deleted
`.trim();
