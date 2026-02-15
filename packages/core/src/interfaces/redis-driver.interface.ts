/**
 * Redis driver abstraction interface.
 *
 * Complete interface for all Redis operations.
 * All Redis operations MUST go through this interface.
 * NEVER import ioredis or redis directly.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class CacheService {
 *   constructor(
 *     @Inject(REDIS_DRIVER) private readonly driver: IRedisDriver
 *   ) {}
 * }
 * ```
 */
export interface IRedisDriver {
  /**
   * Connects to Redis.
   * Called automatically by ClientManager.
   */
  connect(): Promise<void>;

  /**
   * Disconnects from Redis gracefully.
   * Called automatically on module destroy.
   */
  disconnect(): Promise<void>;

  /**
   * Checks if connected to Redis.
   */
  isConnected(): boolean;

  /**
   * Pings Redis server.
   * @returns 'PONG' or custom message
   */
  ping(message?: string): Promise<string>;

  /**
   * Selects database.
   * @param db - Database number (0-15)
   */
  select(db: number): Promise<void>;

  /**
   * Gets value of a key.
   * @returns Value or null if key doesn't exist
   */
  get(key: string): Promise<string | null>;

  /**
   * Sets value of a key with optional TTL.
   * @returns 'OK' if successful, null otherwise
   */
  set(key: string, value: string, options?: ISetOptions): Promise<'OK' | null>;

  /**
   * Gets multiple values.
   * @returns Array of values (null for non-existent keys)
   */
  mget(...keys: string[]): Promise<Array<string | null>>;

  /**
   * Sets multiple key-value pairs.
   * @returns 'OK' if successful
   */
  mset(data: Record<string, string>): Promise<'OK'>;

  /**
   * Sets value only if key doesn't exist.
   * @returns 1 if set, 0 if not set
   */
  setnx(key: string, value: string): Promise<number>;

  /**
   * Sets value with expiration in seconds.
   * @returns 'OK' if successful
   */
  setex(key: string, seconds: number, value: string): Promise<'OK'>;

  /**
   * Gets value and deletes key atomically.
   * @returns Value or null if key doesn't exist
   */
  getdel(key: string): Promise<string | null>;

  /**
   * Gets value and sets expiration atomically.
   * @returns Value or null if key doesn't exist
   */
  getex(key: string, options: { ex?: number; px?: number }): Promise<string | null>;

  /**
   * Increments integer value by 1.
   * @returns New value after increment
   */
  incr(key: string): Promise<number>;

  /**
   * Increments integer value by amount.
   * @returns New value after increment
   */
  incrby(key: string, increment: number): Promise<number>;

  /**
   * Decrements integer value by 1.
   * @returns New value after decrement
   */
  decr(key: string): Promise<number>;

  /**
   * Decrements integer value by amount.
   * @returns New value after decrement
   */
  decrby(key: string, decrement: number): Promise<number>;

  /**
   * Appends value to key.
   * @returns Length of string after append
   */
  append(key: string, value: string): Promise<number>;

  /**
   * Gets length of string value.
   * @returns Length of string, 0 if key doesn't exist
   */
  strlen(key: string): Promise<number>;

  /**
   * Increments value by float amount.
   * @returns New value after increment
   */
  incrbyfloat(key: string, increment: number): Promise<string>;

  /**
   * Gets substring of string value.
   * @param start - Start offset (can be negative)
   * @param end - End offset (can be negative)
   * @returns Substring
   */
  getrange(key: string, start: number, end: number): Promise<string>;

  /**
   * Overwrites part of string at offset.
   * @returns Length of string after modification
   */
  setrange(key: string, offset: number, value: string): Promise<number>;

  /**
   * Sets multiple keys only if none exist.
   * @returns 1 if all keys set, 0 if no keys set
   */
  msetnx(data: Record<string, string>): Promise<number>;

  /**
   * Deletes one or more keys.
   * @returns Number of keys deleted
   */
  del(...keys: string[]): Promise<number>;

  /**
   * Checks if key exists.
   * @returns Number of existing keys
   */
  exists(...keys: string[]): Promise<number>;

  /**
   * Sets TTL on a key (seconds).
   * @returns 1 if timeout was set, 0 if key doesn't exist
   */
  expire(key: string, seconds: number): Promise<number>;

  /**
   * Sets TTL on a key (milliseconds).
   * @returns 1 if timeout was set, 0 if key doesn't exist
   */
  pexpire(key: string, milliseconds: number): Promise<number>;

  /**
   * Sets absolute expiration time (Unix timestamp in seconds).
   * @returns 1 if timeout was set, 0 if key doesn't exist
   */
  expireat(key: string, timestamp: number): Promise<number>;

  /**
   * Gets TTL of a key (seconds).
   * @returns TTL in seconds, -1 if no TTL, -2 if key doesn't exist
   */
  ttl(key: string): Promise<number>;

  /**
   * Gets TTL of a key (milliseconds).
   * @returns TTL in milliseconds, -1 if no TTL, -2 if key doesn't exist
   */
  pttl(key: string): Promise<number>;

  /**
   * Removes expiration from key.
   * @returns 1 if expiration removed, 0 if key has no expiration
   */
  persist(key: string): Promise<number>;

  /**
   * Renames key.
   * @returns 'OK' if successful
   * @throws Error if source key doesn't exist
   */
  rename(key: string, newKey: string): Promise<'OK'>;

  /**
   * Renames key only if new key doesn't exist.
   * @returns 1 if renamed, 0 if new key exists
   */
  renamenx(key: string, newKey: string): Promise<number>;

  /**
   * Gets type of value stored at key.
   * @returns Type name: 'string', 'list', 'set', 'zset', 'hash', 'stream', 'none'
   */
  type(key: string): Promise<string>;

  /**
   * Scans keys matching pattern.
   * @returns Cursor and array of keys
   */
  scan(cursor: number, options?: IScanOptions): Promise<[string, string[]]>;

  /**
   * Deletes keys asynchronously (non-blocking).
   * Better for large keys than del.
   * @returns Number of keys unlinked
   */
  unlink(...keys: string[]): Promise<number>;

  /**
   * Copies key to another key.
   * @param destination - Destination key
   * @param options - Copy options (replace, db)
   * @returns 1 if copied, 0 if not
   */
  copy(source: string, destination: string, options?: ICopyOptions): Promise<number>;

  /**
   * Finds all keys matching pattern.
   * WARNING: Use SCAN in production for large keyspaces.
   * @returns Array of matching keys
   */
  keys(pattern: string): Promise<string[]>;

  /**
   * Alters the last access time of keys.
   * @returns Number of keys touched
   */
  touch(...keys: string[]): Promise<number>;

  /**
   * Returns the internal encoding of a Redis object.
   * @param subcommand - ENCODING, FREQ, IDLETIME, REFCOUNT
   * @returns Object info
   */
  object(subcommand: 'ENCODING' | 'FREQ' | 'IDLETIME' | 'REFCOUNT', key: string): Promise<string | number | null>;

  /**
   * Serializes the value at key.
   * @returns Serialized value or null
   */
  dump(key: string): Promise<string | null>;

  /**
   * Deserializes and stores value at key.
   * @param ttl - TTL in milliseconds (0 = no expiry)
   * @param serializedValue - Serialized value from dump
   * @param options - Restore options
   * @returns 'OK' if successful
   */
  restore(key: string, ttl: number, serializedValue: string, options?: IRestoreOptions): Promise<'OK'>;

  /**
   * Returns server time.
   * @returns [unix timestamp in seconds, microseconds]
   */
  time(): Promise<[string, string]>;

  /**
   * Gets value of hash field.
   * @returns Value or null if field doesn't exist
   */
  hget(key: string, field: string): Promise<string | null>;

  /**
   * Sets value of hash field.
   * @returns 1 if new field, 0 if field updated
   */
  hset(key: string, field: string, value: string): Promise<number>;

  /**
   * Sets multiple hash fields.
   * @returns 'OK' if successful
   */
  hmset(key: string, data: Record<string, string>): Promise<'OK'>;

  /**
   * Gets multiple hash field values.
   * @returns Array of values (null for non-existent fields)
   */
  hmget(key: string, ...fields: string[]): Promise<Array<string | null>>;

  /**
   * Gets all fields and values of hash.
   * @returns Object with field-value pairs
   */
  hgetall(key: string): Promise<Record<string, string>>;

  /**
   * Deletes hash fields.
   * @returns Number of fields deleted
   */
  hdel(key: string, ...fields: string[]): Promise<number>;

  /**
   * Checks if hash field exists.
   * @returns 1 if field exists, 0 otherwise
   */
  hexists(key: string, field: string): Promise<number>;

  /**
   * Gets all field names in hash.
   */
  hkeys(key: string): Promise<string[]>;

  /**
   * Gets all values in hash.
   */
  hvals(key: string): Promise<string[]>;

  /**
   * Gets number of fields in hash.
   */
  hlen(key: string): Promise<number>;

  /**
   * Increments hash field by integer.
   * @returns New value after increment
   */
  hincrby(key: string, field: string, increment: number): Promise<number>;

  /**
   * Scans hash fields.
   * @returns Cursor and array of field-value pairs
   */
  hscan(key: string, cursor: number, options?: IScanOptions): Promise<[string, string[]]>;

  /**
   * Sets hash field only if it doesn't exist.
   * @returns 1 if field set, 0 if field exists
   */
  hsetnx(key: string, field: string, value: string): Promise<number>;

  /**
   * Increments hash field by float.
   * @returns New value as string
   */
  hincrbyfloat(key: string, field: string, increment: number): Promise<string>;

  /**
   * Gets string length of hash field value.
   * @returns Length of field value, 0 if field/key doesn't exist
   */
  hstrlen(key: string, field: string): Promise<number>;

  /**
   * Gets random fields from hash.
   * @param count - Number of fields (negative for duplicates allowed)
   * @param withValues - Include values
   * @returns Random field(s) or field-value pairs
   */
  hrandfield(key: string, count?: number, withValues?: boolean): Promise<string | string[] | null>;

  /**
   * Pushes values to left of list.
   * @returns Length of list after push
   */
  lpush(key: string, ...values: string[]): Promise<number>;

  /**
   * Pushes values to right of list.
   * @returns Length of list after push
   */
  rpush(key: string, ...values: string[]): Promise<number>;

  /**
   * Pops value from left of list.
   * @returns Value or null if list is empty
   */
  lpop(key: string): Promise<string | null>;

  /**
   * Pops value from right of list.
   * @returns Value or null if list is empty
   */
  rpop(key: string): Promise<string | null>;

  /**
   * Gets list length.
   * @returns Number of elements
   */
  llen(key: string): Promise<number>;

  /**
   * Gets list range.
   * @returns Array of values
   */
  lrange(key: string, start: number, stop: number): Promise<string[]>;

  /**
   * Trims list to specified range.
   * @returns 'OK' if successful
   */
  ltrim(key: string, start: number, stop: number): Promise<'OK'>;

  /**
   * Gets element at index.
   * @returns Value or null if index out of range
   */
  lindex(key: string, index: number): Promise<string | null>;

  /**
   * Sets element at index.
   * @returns 'OK' if successful
   */
  lset(key: string, index: number, value: string): Promise<'OK'>;

  /**
   * Inserts element before or after pivot.
   * @param position - BEFORE or AFTER
   * @param pivot - Reference element
   * @param element - Element to insert
   * @returns List length, -1 if pivot not found
   */
  linsert(key: string, position: 'BEFORE' | 'AFTER', pivot: string, element: string): Promise<number>;

  /**
   * Removes elements from list.
   * @param count - Number to remove (0=all, positive=head, negative=tail)
   * @param element - Element to remove
   * @returns Number of removed elements
   */
  lrem(key: string, count: number, element: string): Promise<number>;

  /**
   * Gets index of element in list.
   * @param options - RANK, COUNT, MAXLEN options
   * @returns Index or null if not found
   */
  lpos(key: string, element: string, options?: ILposOptions): Promise<number | number[] | null>;

  /**
   * Blocking left pop from list.
   * @param timeout - Timeout in seconds (0 = block forever)
   * @returns [key, element] or null on timeout
   */
  blpop(keys: string[], timeout: number): Promise<[string, string] | null>;

  /**
   * Blocking right pop from list.
   * @param timeout - Timeout in seconds (0 = block forever)
   * @returns [key, element] or null on timeout
   */
  brpop(keys: string[], timeout: number): Promise<[string, string] | null>;

  /**
   * Atomically moves element between lists.
   * @param source - Source list key
   * @param destination - Destination list key
   * @param from - LEFT or RIGHT
   * @param to - LEFT or RIGHT
   * @returns Moved element or null
   */
  lmove(source: string, destination: string, from: 'LEFT' | 'RIGHT', to: 'LEFT' | 'RIGHT'): Promise<string | null>;

  /**
   * Blocking version of lmove.
   * @param timeout - Timeout in seconds
   * @returns Moved element or null on timeout
   */
  blmove(source: string, destination: string, from: 'LEFT' | 'RIGHT', to: 'LEFT' | 'RIGHT', timeout: number): Promise<string | null>;

  /**
   * Adds members to set.
   * @returns Number of members added
   */
  sadd(key: string, ...members: string[]): Promise<number>;

  /**
   * Removes members from set.
   * @returns Number of members removed
   */
  srem(key: string, ...members: string[]): Promise<number>;

  /**
   * Gets all members of set.
   */
  smembers(key: string): Promise<string[]>;

  /**
   * Checks if member is in set.
   * @returns 1 if member exists, 0 otherwise
   */
  sismember(key: string, member: string): Promise<number>;

  /**
   * Gets number of members in set.
   */
  scard(key: string): Promise<number>;

  /**
   * Gets random member from set.
   * @returns Random member or null if set is empty
   */
  srandmember(key: string, count?: number): Promise<string | string[] | null>;

  /**
   * Pops random member from set.
   * @returns Random member or null if set is empty
   */
  spop(key: string, count?: number): Promise<string | string[] | null>;

  /**
   * Scans set members.
   * @returns Cursor and array of members
   */
  sscan(key: string, cursor: number, options?: IScanOptions): Promise<[string, string[]]>;

  /**
   * Moves member from one set to another.
   * @returns 1 if moved, 0 if member not in source
   */
  smove(source: string, destination: string, member: string): Promise<number>;

  /**
   * Returns intersection of sets.
   * @returns Array of common members
   */
  sinter(...keys: string[]): Promise<string[]>;

  /**
   * Stores intersection of sets.
   * @returns Number of members in result
   */
  sinterstore(destination: string, ...keys: string[]): Promise<number>;

  /**
   * Returns union of sets.
   * @returns Array of all unique members
   */
  sunion(...keys: string[]): Promise<string[]>;

  /**
   * Stores union of sets.
   * @returns Number of members in result
   */
  sunionstore(destination: string, ...keys: string[]): Promise<number>;

  /**
   * Returns difference of sets (first - others).
   * @returns Array of members in first set but not in others
   */
  sdiff(...keys: string[]): Promise<string[]>;

  /**
   * Stores difference of sets.
   * @returns Number of members in result
   */
  sdiffstore(destination: string, ...keys: string[]): Promise<number>;

  /**
   * Checks if multiple members are in set.
   * @returns Array of 1/0 for each member
   */
  smismember(key: string, ...members: string[]): Promise<number[]>;

  /**
   * Adds members to sorted set with scores.
   * @returns Number of members added
   */
  zadd(key: string, ...args: Array<number | string>): Promise<number>;

  /**
   * Removes members from sorted set.
   * @returns Number of members removed
   */
  zrem(key: string, ...members: string[]): Promise<number>;

  /**
   * Gets members in range by index.
   */
  zrange(key: string, start: number, stop: number, withScores?: boolean): Promise<string[]>;

  /**
   * Gets members in range by score.
   */
  zrangebyscore(key: string, min: number | string, max: number | string, withScores?: boolean): Promise<string[]>;

  /**
   * Gets score of member.
   * @returns Score or null if member doesn't exist
   */
  zscore(key: string, member: string): Promise<string | null>;

  /**
   * Gets number of members in sorted set.
   */
  zcard(key: string): Promise<number>;

  /**
   * Gets rank of member (0-based, lowest score first).
   * @returns Rank or null if member doesn't exist
   */
  zrank(key: string, member: string): Promise<number | null>;

  /**
   * Increments score of member.
   * @returns New score
   */
  zincrby(key: string, increment: number, member: string): Promise<string>;

  /**
   * Scans sorted set members.
   * @returns Cursor and array of member-score pairs
   */
  zscan(key: string, cursor: number, options?: IScanOptions): Promise<[string, string[]]>;

  /**
   * Gets reverse rank of member (highest score first).
   * @returns Rank or null if member doesn't exist
   */
  zrevrank(key: string, member: string): Promise<number | null>;

  /**
   * Counts members with scores in range.
   * @returns Number of members
   */
  zcount(key: string, min: number | string, max: number | string): Promise<number>;

  /**
   * Counts members in lexicographical range.
   * @returns Number of members
   */
  zlexcount(key: string, min: string, max: string): Promise<number>;

  /**
   * Removes and returns members with lowest scores.
   * @returns Array of [member, score] pairs
   */
  zpopmin(key: string, count?: number): Promise<string[]>;

  /**
   * Removes and returns members with highest scores.
   * @returns Array of [member, score] pairs
   */
  zpopmax(key: string, count?: number): Promise<string[]>;

  /**
   * Blocking pop from sorted set (lowest score).
   * @param timeout - Timeout in seconds
   * @returns [key, member, score] or null on timeout
   */
  bzpopmin(keys: string[], timeout: number): Promise<[string, string, string] | null>;

  /**
   * Blocking pop from sorted set (highest score).
   * @param timeout - Timeout in seconds
   * @returns [key, member, score] or null on timeout
   */
  bzpopmax(keys: string[], timeout: number): Promise<[string, string, string] | null>;

  /**
   * Computes union of sorted sets and stores result.
   * @param destination - Destination key
   * @param keys - Source keys
   * @param options - WEIGHTS and AGGREGATE options
   * @returns Number of elements in result
   */
  zunionstore(destination: string, keys: string[], options?: IZStoreOptions): Promise<number>;

  /**
   * Computes intersection of sorted sets and stores result.
   * @param destination - Destination key
   * @param keys - Source keys
   * @param options - WEIGHTS and AGGREGATE options
   * @returns Number of elements in result
   */
  zinterstore(destination: string, keys: string[], options?: IZStoreOptions): Promise<number>;

  /**
   * Gets scores of multiple members.
   * @returns Array of scores (null for non-existent members)
   */
  zmscore(key: string, ...members: string[]): Promise<Array<string | null>>;

  /**
   * Gets random members from sorted set.
   * @param count - Number of members (negative for duplicates allowed)
   * @param withScores - Include scores
   * @returns Random member(s) or member-score pairs
   */
  zrandmember(key: string, count?: number, withScores?: boolean): Promise<string | string[] | null>;

  /**
   * Gets members in score range in reverse order.
   * @returns Array of members (with scores if withScores)
   */
  zrevrangebyscore(key: string, max: number | string, min: number | string, options?: IZRangeByScoreOptions): Promise<string[]>;

  /**
   * Publishes message to channel.
   * @returns Number of subscribers that received the message
   */
  publish(channel: string, message: string): Promise<number>;

  /**
   * Subscribes to channels.
   */
  subscribe(...channels: string[]): Promise<void>;

  /**
   * Unsubscribes from channels.
   */
  unsubscribe(...channels: string[]): Promise<void>;

  /**
   * Subscribes to channels by pattern.
   */
  psubscribe(...patterns: string[]): Promise<void>;

  /**
   * Unsubscribes from channel patterns.
   */
  punsubscribe(...patterns: string[]): Promise<void>;

  /**
   * Adds entry to stream.
   * @param key - Stream key
   * @param id - Entry ID ('*' for auto-generated)
   * @param fields - Field-value pairs
   * @param options - Optional MAXLEN/MINID trimming
   * @returns Entry ID
   */
  xadd(key: string, id: string, fields: Record<string, string>, options?: IStreamAddOptions): Promise<string>;

  /**
   * Reads entries from streams.
   * @param streams - Stream keys and IDs to read from
   * @param options - Read options (COUNT, BLOCK)
   * @returns Array of stream entries or null
   */
  xread(streams: Array<{ key: string; id: string }>, options?: IStreamReadOptions): Promise<StreamReadResult | null>;

  /**
   * Reads entries from streams using consumer group.
   * @param group - Consumer group name
   * @param consumer - Consumer name
   * @param streams - Stream keys and IDs to read from
   * @param options - Read options (COUNT, BLOCK, NOACK)
   * @returns Array of stream entries or null
   */
  xreadgroup(group: string, consumer: string, streams: Array<{ key: string; id: string }>, options?: IStreamReadGroupOptions): Promise<StreamReadResult | null>;

  /**
   * Gets range of entries from stream.
   * @param key - Stream key
   * @param start - Start ID ('-' for oldest)
   * @param end - End ID ('+' for newest)
   * @param options - Optional COUNT
   * @returns Array of entries
   */
  xrange(key: string, start: string, end: string, options?: { count?: number }): Promise<IStreamEntry[]>;

  /**
   * Gets range of entries in reverse order.
   * @param key - Stream key
   * @param end - End ID ('+' for newest)
   * @param start - Start ID ('-' for oldest)
   * @param options - Optional COUNT
   * @returns Array of entries
   */
  xrevrange(key: string, end: string, start: string, options?: { count?: number }): Promise<IStreamEntry[]>;

  /**
   * Gets stream length.
   * @param key - Stream key
   * @returns Number of entries
   */
  xlen(key: string): Promise<number>;

  /**
   * Gets stream information.
   * @param key - Stream key
   * @returns Stream info object
   */
  xinfo(key: string): Promise<IStreamInfo>;

  /**
   * Trims stream to specified length.
   * @param key - Stream key
   * @param maxLen - Maximum length
   * @param approximate - Use '~' for approximate trimming (better performance)
   * @returns Number of entries removed
   */
  xtrim(key: string, maxLen: number, approximate?: boolean): Promise<number>;

  /**
   * Creates consumer group.
   * @param key - Stream key
   * @param group - Group name
   * @param id - Start ID ('$' for new entries only, '0' for all)
   * @param mkstream - Create stream if doesn't exist
   * @returns 'OK' if successful
   */
  xgroupCreate(key: string, group: string, id: string, mkstream?: boolean): Promise<'OK'>;

  /**
   * Destroys consumer group.
   * @param key - Stream key
   * @param group - Group name
   * @returns 1 if destroyed, 0 if didn't exist
   */
  xgroupDestroy(key: string, group: string): Promise<number>;

  /**
   * Deletes consumer from group.
   * @param key - Stream key
   * @param group - Group name
   * @param consumer - Consumer name
   * @returns Number of pending messages removed
   */
  xgroupDelConsumer(key: string, group: string, consumer: string): Promise<number>;

  /**
   * Sets consumer group last delivered ID.
   * @param key - Stream key
   * @param group - Group name
   * @param id - New last ID
   * @returns 'OK' if successful
   */
  xgroupSetId(key: string, group: string, id: string): Promise<'OK'>;

  /**
   * Acknowledges message processing.
   * @param key - Stream key
   * @param group - Group name
   * @param ids - Message IDs to acknowledge
   * @returns Number of messages acknowledged
   */
  xack(key: string, group: string, ...ids: string[]): Promise<number>;

  /**
   * Gets pending messages info.
   * @param key - Stream key
   * @param group - Group name
   * @returns Pending info summary
   */
  xpending(key: string, group: string): Promise<IStreamPendingInfo>;

  /**
   * Gets detailed pending messages.
   * @param key - Stream key
   * @param group - Group name
   * @param start - Start ID
   * @param end - End ID
   * @param count - Max entries to return
   * @param consumer - Optional consumer filter
   * @returns Array of pending entries
   */
  xpendingRange(key: string, group: string, start: string, end: string, count: number, consumer?: string): Promise<IStreamPendingEntry[]>;

  /**
   * Claims messages from another consumer.
   * @param key - Stream key
   * @param group - Group name
   * @param consumer - New consumer
   * @param minIdleTime - Minimum idle time in ms
   * @param ids - Message IDs to claim
   * @returns Claimed entries
   */
  xclaim(key: string, group: string, consumer: string, minIdleTime: number, ...ids: string[]): Promise<IStreamEntry[]>;

  /**
   * Deletes entries from stream.
   * @param key - Stream key
   * @param ids - Entry IDs to delete
   * @returns Number of entries deleted
   */
  xdel(key: string, ...ids: string[]): Promise<number>;

  /**
   * Creates a pipeline for batching commands.
   * Commands are executed atomically but not transactionally.
   */
  pipeline(): IPipeline;

  /**
   * Creates a multi/exec transaction.
   * Commands are executed atomically and transactionally.
   */
  multi(): IMulti;

  /**
   * Evaluates Lua script.
   * @param script - Lua script source
   * @param keys - KEYS array
   * @param args - ARGV array
   * @returns Script result
   */
  eval(script: string, keys: string[], args: Array<string | number>): Promise<unknown>;

  /**
   * Evaluates Lua script by SHA.
   * @param sha - Script SHA hash
   * @param keys - KEYS array
   * @param args - ARGV array
   * @returns Script result
   */
  evalsha(sha: string, keys: string[], args: Array<string | number>): Promise<unknown>;

  /**
   * Loads Lua script and returns SHA.
   * @param script - Lua script source
   * @returns SHA hash
   */
  scriptLoad(script: string): Promise<string>;

  /**
   * Checks if scripts exist.
   * @param shas - Script SHA hashes
   * @returns Array of 1/0 for each script
   */
  scriptExists(...shas: string[]): Promise<number[]>;

  /**
   * Flushes all scripts from cache.
   * @returns 'OK' if successful
   */
  scriptFlush(): Promise<'OK'>;

  /**
   * Flushes all keys from current database.
   * @returns 'OK' if successful
   */
  flushdb(): Promise<'OK'>;

  /**
   * Flushes all keys from all databases.
   * @returns 'OK' if successful
   */
  flushall(): Promise<'OK'>;

  /**
   * Gets server info.
   * @param section - Optional info section
   * @returns Info string
   */
  info(section?: string): Promise<string>;

  /**
   * Gets database size (number of keys).
   * @returns Number of keys
   */
  dbsize(): Promise<number>;

  /**
   * Adds elements to HyperLogLog.
   * @returns 1 if cardinality changed, 0 otherwise
   */
  pfadd(key: string, ...elements: string[]): Promise<number>;

  /**
   * Returns estimated cardinality.
   * @returns Estimated number of unique elements
   */
  pfcount(...keys: string[]): Promise<number>;

  /**
   * Merges HyperLogLogs into destination.
   * @returns 'OK' if successful
   */
  pfmerge(destination: string, ...sources: string[]): Promise<'OK'>;

  /**
   * Adds geospatial members.
   * @param members - Array of [longitude, latitude, member]
   * @returns Number of members added
   */
  geoadd(key: string, ...members: Array<number | string>): Promise<number>;

  /**
   * Returns distance between two members.
   * @param unit - m, km, mi, ft
   * @returns Distance or null if member doesn't exist
   */
  geodist(key: string, member1: string, member2: string, unit?: GeoUnit): Promise<string | null>;

  /**
   * Returns geohash strings for members.
   * @returns Array of geohash strings (null for non-existent)
   */
  geohash(key: string, ...members: string[]): Promise<Array<string | null>>;

  /**
   * Returns positions of members.
   * @returns Array of [longitude, latitude] or null
   */
  geopos(key: string, ...members: string[]): Promise<Array<[string, string] | null>>;

  /**
   * Searches for members in radius.
   * @returns Array of members with optional distance/coordinates
   */
  geosearch(key: string, options: IGeoSearchOptions): Promise<Array<string | IGeoSearchResult>>;

  /**
   * Searches and stores result.
   * @returns Number of members in result
   */
  geosearchstore(destination: string, source: string, options: IGeoSearchOptions & { storedist?: boolean }): Promise<number>;

  /**
   * Sets bit at offset.
   * @returns Previous bit value
   */
  setbit(key: string, offset: number, value: 0 | 1): Promise<number>;

  /**
   * Gets bit at offset.
   * @returns Bit value (0 or 1)
   */
  getbit(key: string, offset: number): Promise<number>;

  /**
   * Counts set bits in range.
   * @param start - Start byte offset
   * @param end - End byte offset
   * @param mode - BYTE or BIT
   * @returns Number of set bits
   */
  bitcount(key: string, start?: number, end?: number, mode?: 'BYTE' | 'BIT'): Promise<number>;

  /**
   * Performs bitwise operations.
   * @param operation - AND, OR, XOR, NOT
   * @param destKey - Destination key
   * @param keys - Source keys (one for NOT)
   * @returns Size of result in bytes
   */
  bitop(operation: 'AND' | 'OR' | 'XOR' | 'NOT', destKey: string, ...keys: string[]): Promise<number>;

  /**
   * Finds first bit set to value.
   * @param bit - 0 or 1
   * @param start - Start byte offset
   * @param end - End byte offset
   * @param mode - BYTE or BIT
   * @returns Position of first bit, -1 if not found
   */
  bitpos(key: string, bit: 0 | 1, start?: number, end?: number, mode?: 'BYTE' | 'BIT'): Promise<number>;

  /**
   * Executes Redis Cluster commands.
   * @param subcommand - Cluster subcommand (INFO, NODES, etc.)
   * @param args - Additional arguments
   * @returns Command result
   */
  cluster(subcommand: string, ...args: Array<string | number>): Promise<unknown>;

  /**
   * Executes Redis Sentinel commands.
   * @param subcommand - Sentinel subcommand (masters, master, replicas, etc.)
   * @param args - Additional arguments
   * @returns Command result
   */
  sentinel(subcommand: string, ...args: Array<string | number>): Promise<unknown>;

  /**
   * Registers event handler.
   */
  on(event: DriverEvent, handler: DriverEventHandler): void;

  /**
   * Registers one-time event handler.
   */
  once(event: DriverEvent, handler: DriverEventHandler): void;

  /**
   * Unregisters event handler.
   */
  off(event: DriverEvent, handler: DriverEventHandler): void;

  /**
   * Removes all listeners for event.
   */
  removeAllListeners(event?: DriverEvent): void;
}

/**
 * Options for SET command.
 */
export interface ISetOptions {
  /**
   * Expiration in seconds (EX).
   */
  ex?: number;

  /**
   * Expiration in milliseconds (PX).
   */
  px?: number;

  /**
   * Expiration Unix timestamp in seconds (EXAT).
   */
  exat?: number;

  /**
   * Expiration Unix timestamp in milliseconds (PXAT).
   */
  pxat?: number;

  /**
   * Only set if key exists (XX).
   */
  xx?: boolean;

  /**
   * Only set if key doesn't exist (NX).
   */
  nx?: boolean;

  /**
   * Return previous value (GET).
   */
  get?: boolean;

  /**
   * Keep existing TTL (KEEPTTL).
   */
  keepttl?: boolean;
}

/**
 * Options for SCAN family commands.
 */
export interface IScanOptions {
  /**
   * Match pattern.
   */
  match?: string;

  /**
   * Count hint (not exact).
   */
  count?: number;

  /**
   * Type filter (for SCAN only).
   */
  type?: string;
}

/**
 * Pipeline for batching Redis commands.
 * Commands are buffered and sent to server in a single round-trip.
 */
export interface IPipeline {
  /**
   * Executes all queued commands.
   * @returns Array of [error, result] tuples for each command
   */
  exec(): Promise<Array<[Error | null, unknown]>>;

  // All driver methods can be chained
  get(key: string): this;
  set(key: string, value: string, options?: ISetOptions): this;
  del(...keys: string[]): this;
  mget(...keys: string[]): this;
  mset(data: Record<string, string>): this;
  expire(key: string, seconds: number): this;
  ttl(key: string): this;
  incr(key: string): this;
  incrby(key: string, increment: number): this;
  hget(key: string, field: string): this;
  hset(key: string, field: string, value: string): this;
  hmset(key: string, data: Record<string, string>): this;
  hgetall(key: string): this;
  lpush(key: string, ...values: string[]): this;
  rpush(key: string, ...values: string[]): this;
  sadd(key: string, ...members: string[]): this;
  srem(key: string, ...members: string[]): this;
  zadd(key: string, ...args: Array<number | string>): this;
  zrem(key: string, ...members: string[]): this;
}

/**
 * Multi/Exec transaction.
 * Commands are executed atomically and transactionally.
 */
export interface IMulti extends IPipeline {
  /**
   * Discards transaction.
   */
  discard(): void;
}

/**
 * Options for XADD command.
 */
export interface IStreamAddOptions {
  /**
   * Maximum stream length (MAXLEN).
   */
  maxLen?: number;

  /**
   * Use approximate trimming (~) for better performance.
   */
  approximate?: boolean;

  /**
   * Only add if stream exists (NOMKSTREAM).
   */
  noMkStream?: boolean;

  /**
   * Minimum ID for trimming (MINID).
   */
  minId?: string;
}

/**
 * Options for XREAD command.
 */
export interface IStreamReadOptions {
  /**
   * Maximum entries per stream.
   */
  count?: number;

  /**
   * Block timeout in milliseconds (0 = forever).
   */
  block?: number;
}

/**
 * Options for XREADGROUP command.
 */
export interface IStreamReadGroupOptions extends IStreamReadOptions {
  /**
   * Don't add to pending list.
   */
  noAck?: boolean;
}

/**
 * Single stream entry.
 */
export interface IStreamEntry {
  /**
   * Entry ID (timestamp-sequence).
   */
  id: string;

  /**
   * Entry fields.
   */
  fields: Record<string, string>;
}

/**
 * Result from XREAD/XREADGROUP.
 */
export type StreamReadResult = Array<{
  /**
   * Stream key.
   */
  key: string;

  /**
   * Entries read from stream.
   */
  entries: IStreamEntry[];
}>;

/**
 * Stream information from XINFO.
 */
export interface IStreamInfo {
  /**
   * Number of entries.
   */
  length: number;

  /**
   * Number of consumer groups.
   */
  groups: number;

  /**
   * First entry ID.
   */
  firstEntry: IStreamEntry | null;

  /**
   * Last entry ID.
   */
  lastEntry: IStreamEntry | null;

  /**
   * Last generated ID.
   */
  lastGeneratedId: string;

  /**
   * Radix tree keys.
   */
  radixTreeKeys: number;

  /**
   * Radix tree nodes.
   */
  radixTreeNodes: number;
}

/**
 * Pending messages summary from XPENDING.
 */
export interface IStreamPendingInfo {
  /**
   * Total pending count.
   */
  count: number;

  /**
   * Smallest pending ID.
   */
  minId: string | null;

  /**
   * Largest pending ID.
   */
  maxId: string | null;

  /**
   * Pending count per consumer.
   */
  consumers: Array<{ name: string; count: number }>;
}

/**
 * Single pending entry from XPENDING with range.
 */
export interface IStreamPendingEntry {
  /**
   * Entry ID.
   */
  id: string;

  /**
   * Consumer name.
   */
  consumer: string;

  /**
   * Idle time in milliseconds.
   */
  idleTime: number;

  /**
   * Delivery count.
   */
  deliveryCount: number;
}

/**
 * Driver events.
 */
export enum DriverEvent {
  CONNECT = 'connect',
  READY = 'ready',
  DISCONNECT = 'disconnect',
  CLOSE = 'close',
  ERROR = 'error',
  RECONNECTING = 'reconnecting',
  END = 'end',
}

/**
 * Driver event handler.
 */
export type DriverEventHandler = (data?: unknown) => void;

/**
 * Options for COPY command.
 */
export interface ICopyOptions {
  /**
   * Target database number.
   */
  db?: number;

  /**
   * Replace existing key.
   */
  replace?: boolean;
}

/**
 * Options for RESTORE command.
 */
export interface IRestoreOptions {
  /**
   * Replace existing key.
   */
  replace?: boolean;

  /**
   * Absolute Unix timestamp (milliseconds) for expiration.
   */
  absttl?: boolean;

  /**
   * Eviction time in seconds.
   */
  idletime?: number;

  /**
   * Eviction frequency.
   */
  freq?: number;
}

/**
 * Options for LPOS command.
 */
export interface ILposOptions {
  /**
   * Search from Nth match.
   */
  rank?: number;

  /**
   * Return count matches.
   */
  count?: number;

  /**
   * Limit comparisons.
   */
  maxlen?: number;
}

/**
 * Options for ZRANGEBYSCORE command.
 */
export interface IZRangeByScoreOptions {
  /**
   * Include scores in result.
   */
  withScores?: boolean;

  /**
   * Limit results.
   */
  limit?: {
    offset: number;
    count: number;
  };
}

/**
 * Options for ZUNIONSTORE/ZINTERSTORE commands.
 */
export interface IZStoreOptions {
  /**
   * Weight for each input key.
   */
  weights?: number[];

  /**
   * How to aggregate scores.
   */
  aggregate?: 'SUM' | 'MIN' | 'MAX';
}

/**
 * Geo distance unit.
 */
export type GeoUnit = 'm' | 'km' | 'mi' | 'ft';

/**
 * Options for GEOSEARCH command.
 */
export interface IGeoSearchOptions {
  /**
   * Search from member.
   */
  member?: string;

  /**
   * Search from coordinates.
   */
  coord?: {
    longitude: number;
    latitude: number;
  };

  /**
   * Search by radius.
   */
  radius?: {
    value: number;
    unit: GeoUnit;
  };

  /**
   * Search by box.
   */
  box?: {
    width: number;
    height: number;
    unit: GeoUnit;
  };

  /**
   * Sort order.
   */
  sort?: 'ASC' | 'DESC';

  /**
   * Limit results.
   */
  count?: number;

  /**
   * Use ANY with count.
   */
  any?: boolean;

  /**
   * Include coordinates.
   */
  withCoord?: boolean;

  /**
   * Include distance.
   */
  withDist?: boolean;

  /**
   * Include hash.
   */
  withHash?: boolean;
}

/**
 * Geo search result with optional data.
 */
export interface IGeoSearchResult {
  member: string;
  distance?: string;
  hash?: number;
  coordinates?: [string, string];
}
