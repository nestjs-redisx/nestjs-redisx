/**
 * Inline Lua scripts for leader election.
 *
 * Scripts are stored as inline strings to avoid issues with file reading
 * after build (dist directory doesn't contain .lua files). All three
 * scripts are single-key (cluster-safe without hash tags) and use only
 * idioms the in-memory Lua interpreter supports (`if x == ARGV[1] then`
 * comparison, truthiness of the SET reply).
 */

/**
 * Acquire the lease, or re-claim it when this instance already holds it.
 *
 * The re-claim branch matters: after an unconfirmed renewal (store error) the
 * service demotes itself locally while the key may still hold THIS instance's
 * id, and a restart with a stable `instanceId` leaves a stale own lease
 * behind. A plain SET NX can never win against our own key - the group would
 * stay leaderless until the lease expired. Re-claiming is CAS on our own id,
 * so it can never steal another instance's seat.
 *
 * ORDER MATTERS: the own-id check runs BEFORE the SET. Redis 7.x checks the
 * denyoom flag per redis.call, so under maxmemory pressure a leading SET
 * aborts the whole script even when the key already holds our id and only
 * the OOM-safe GET+PEXPIRE re-claim would actually run - forfeiting a
 * leadership the renew script (GET+PEXPIRE, OOM-immune) would have kept.
 * With the re-claim first, an OOM episode only blocks FRESH acquires (a
 * loud, contained error), never the re-seating of an existing own lease.
 * Atomicity makes the two orders result-equivalent otherwise.
 *
 * KEYS[1] = election key
 * ARGV[1] = instance id
 * ARGV[2] = ttl in milliseconds
 *
 * Returns: 1 when the lease is now held by this instance, 0 when it is held
 * by someone else.
 */
export const ACQUIRE_LEADER_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end
if redis.call("set", KEYS[1], ARGV[1], "NX", "PX", ARGV[2]) then
  return 1
end
return 0
`.trim();

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
