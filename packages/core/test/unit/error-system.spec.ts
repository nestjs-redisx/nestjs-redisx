import { describe, it, expect } from 'vitest';
import { RedisXError, ErrorCode, RedisConnectionError, RedisTimeoutError, RedisClusterError, RedisSentinelError, RedisAuthError, RedisTLSError, RedisMaxRetriesError, RedisPoolExhaustedError, RedisOperationError, RedisKeyNotFoundError, RedisTypeMismatchError, RedisScriptError, RedisTransactionError, RedisPipelineError, RedisInvalidArgsError, RedisOutOfMemoryError, RedisReadOnlyError, RedisNotSupportedError, RedisNotConnectedError, RedisConfigError, RedisValidationError, ValidationErrorCollector, getErrorDomain, isErrorDomain, isErrorCode } from '../../src/errors';

describe('Error System', () => {
  describe('RedisXError', () => {
    it('should create error with code and message', () => {
      // When
      const error = new RedisXError('Test error', ErrorCode.UNKNOWN);

      // Then
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe(ErrorCode.UNKNOWN);
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('should include cause error', () => {
      // Given
      const cause = new Error('Original error');

      // When
      const error = new RedisXError('Wrapped error', ErrorCode.UNKNOWN, cause);

      // Then
      expect(error.cause).toBe(cause);
    });

    it('should include context', () => {
      // Given
      const context = { key: 'value', count: 42 };

      // When
      const error = new RedisXError('Test error', ErrorCode.UNKNOWN, undefined, context);

      // Then
      expect(error.context).toEqual(context);
    });

    it('should check error code with is()', () => {
      // Given
      const error = new RedisXError('Test', ErrorCode.CONN_FAILED);

      // When/Then
      expect(error.is(ErrorCode.CONN_FAILED)).toBe(true);
      expect(error.is(ErrorCode.CONN_TIMEOUT)).toBe(false);
    });

    it('should check multiple codes with isAnyOf()', () => {
      // Given
      const error = new RedisXError('Test', ErrorCode.LOCK_EXPIRED);

      // When/Then
      expect(error.isAnyOf([ErrorCode.LOCK_EXPIRED, ErrorCode.LOCK_NOT_OWNED])).toBe(true);
      expect(error.isAnyOf([ErrorCode.CONN_FAILED, ErrorCode.OP_TIMEOUT])).toBe(false);
    });

    it('should serialize to JSON', () => {
      // Given
      const cause = new Error('Cause error');
      const context = { test: 'data' };
      const error = new RedisXError('Test error', ErrorCode.CONN_FAILED, cause, context);

      // When
      const json = error.toJSON();

      // Then
      expect(json.name).toBe('RedisXError');
      expect(json.message).toBe('Test error');
      expect(json.code).toBe(ErrorCode.CONN_FAILED);
      expect(json.timestamp).toBeDefined();
      expect(json.context).toEqual(context);
      expect(json.cause).toBeDefined();
      expect(json.cause?.message).toBe('Cause error');
      expect(json.stack).toBeDefined();
    });

    it('should convert to string', () => {
      // Given
      const error = new RedisXError('Test error', ErrorCode.CONN_FAILED);

      // When
      const str = error.toString();

      // Then
      expect(str).toContain('RedisXError');
      expect(str).toContain(ErrorCode.CONN_FAILED);
      expect(str).toContain('Test error');
    });

    it('should wrap unknown errors', () => {
      // Given
      const error = new Error('Original error');

      // When
      const wrapped = RedisXError.wrap(error, ErrorCode.CONN_FAILED);

      // Then
      expect(wrapped).toBeInstanceOf(RedisXError);
      expect(wrapped.message).toBe('Original error');
      expect(wrapped.code).toBe(ErrorCode.CONN_FAILED);
      expect(wrapped.cause).toBe(error);
    });

    it('should not wrap RedisXError', () => {
      // Given
      const error = new RedisXError('Test', ErrorCode.CONN_FAILED);

      // When
      const wrapped = RedisXError.wrap(error);

      // Then
      expect(wrapped).toBe(error);
    });

    it('should wrap non-Error values', () => {
      // When
      const wrapped = RedisXError.wrap('String error', ErrorCode.UNKNOWN);

      // Then
      expect(wrapped).toBeInstanceOf(RedisXError);
      expect(wrapped.message).toBe('String error');
      expect(wrapped.context?.originalError).toBe('String error');
    });

    it('should check if value is RedisXError', () => {
      // Given
      const redisError = new RedisXError('Test', ErrorCode.UNKNOWN);
      const normalError = new Error('Normal error');

      // When/Then
      expect(RedisXError.isRedisXError(redisError)).toBe(true);
      expect(RedisXError.isRedisXError(normalError)).toBe(false);
      expect(RedisXError.isRedisXError('string')).toBe(false);
    });
  });

  describe('ErrorCode utilities', () => {
    it('should get error domain', () => {
      // When/Then
      expect(getErrorDomain(ErrorCode.CONN_FAILED)).toBe('CONN');
      expect(getErrorDomain(ErrorCode.OP_TIMEOUT)).toBe('OP');
      expect(getErrorDomain(ErrorCode.CFG_INVALID)).toBe('CFG');
      expect(getErrorDomain(ErrorCode.CACHE_KEY_INVALID)).toBe('CACHE');
      expect(getErrorDomain(ErrorCode.LOCK_EXPIRED)).toBe('LOCK');
    });

    it('should check error domain', () => {
      // When/Then
      expect(isErrorDomain(ErrorCode.CONN_FAILED, 'CONN')).toBe(true);
      expect(isErrorDomain(ErrorCode.CONN_TIMEOUT, 'CONN')).toBe(true);
      expect(isErrorDomain(ErrorCode.OP_TIMEOUT, 'CONN')).toBe(false);
      expect(isErrorDomain(ErrorCode.OP_TIMEOUT, 'OP')).toBe(true);
    });
  });

  describe('RedisConnectionError', () => {
    it('should create connection error with host and port', () => {
      // When
      const error = new RedisConnectionError('Connection failed', ErrorCode.CONN_FAILED, 'localhost', 6379);

      // Then
      expect(error).toBeInstanceOf(RedisXError);
      expect(error.host).toBe('localhost');
      expect(error.port).toBe(6379);
      expect(error.context?.host).toBe('localhost');
      expect(error.context?.port).toBe(6379);
    });

    it('should create with factory method', () => {
      // When
      const error = RedisConnectionError.create('Failed to connect', 'redis.example.com', 6380);

      // Then
      expect(error).toBeInstanceOf(RedisConnectionError);
      expect(error.code).toBe(ErrorCode.CONN_FAILED);
      expect(error.host).toBe('redis.example.com');
      expect(error.port).toBe(6380);
    });
  });

  describe('RedisTimeoutError', () => {
    it('should create timeout error for connection', () => {
      // When
      const error = new RedisTimeoutError('Connection', 5000, 'localhost', 6379);

      // Then
      expect(error).toBeInstanceOf(RedisConnectionError);
      expect(error.message).toContain('Connection');
      expect(error.message).toContain('5000ms');
      expect(error.operation).toBe('Connection');
      expect(error.timeoutMs).toBe(5000);
    });

    it('should create timeout error for operation', () => {
      // When
      const error = new RedisTimeoutError('GET', 1000);

      // Then
      expect(error.message).toContain('GET');
      expect(error.message).toContain('1000ms');
      expect(error.code).toBe(ErrorCode.OP_TIMEOUT);
    });
  });

  describe('RedisClusterError', () => {
    it('should create cluster down error', () => {
      // When
      const error = RedisClusterError.clusterDown('node1', 7000);

      // Then
      expect(error).toBeInstanceOf(RedisConnectionError);
      expect(error.code).toBe(ErrorCode.CONN_CLUSTER_DOWN);
      expect(error.message).toContain('unreachable');
    });

    it('should create MOVED redirection error', () => {
      // When
      const error = RedisClusterError.moved(1234, 'node2', 7001);

      // Then
      expect(error.code).toBe(ErrorCode.CONN_CLUSTER_MOVED);
      expect(error.message).toContain('1234');
      expect(error.message).toContain('node2:7001');
      expect(error.context?.slot).toBe(1234);
      expect(error.context?.targetHost).toBe('node2');
      expect(error.context?.targetPort).toBe(7001);
    });

    it('should create ASK redirection error', () => {
      // When
      const error = RedisClusterError.ask(5678, 'node3', 7002);

      // Then
      expect(error.code).toBe(ErrorCode.CONN_CLUSTER_ASK);
      expect(error.message).toContain('ASK');
      expect(error.message).toContain('5678');
    });
  });

  describe('RedisSentinelError', () => {
    it('should create no master error', () => {
      // When
      const error = RedisSentinelError.noMaster('mymaster', [
        { host: 'sentinel1', port: 26379 },
        { host: 'sentinel2', port: 26379 },
      ]);

      // Then
      expect(error.code).toBe(ErrorCode.CONN_SENTINEL_NO_MASTER);
      expect(error.message).toContain('mymaster');
      expect(error.masterName).toBe('mymaster');
      expect(error.context?.sentinels).toHaveLength(2);
    });

    it('should create failover error', () => {
      // When
      const error = RedisSentinelError.failover('mymaster', 'old-master:6379', 'new-master:6379');

      // Then
      expect(error.code).toBe(ErrorCode.CONN_SENTINEL_FAILOVER);
      expect(error.message).toContain('failover');
      expect(error.context?.oldMaster).toBe('old-master:6379');
      expect(error.context?.newMaster).toBe('new-master:6379');
    });
  });

  describe('RedisOperationError', () => {
    it('should create operation error', () => {
      // When
      const error = RedisOperationError.create('Operation failed', 'GET');

      // Then
      expect(error).toBeInstanceOf(RedisXError);
      expect(error.code).toBe(ErrorCode.OP_FAILED);
      expect(error.command).toBe('GET');
    });

    it('should create from command and args', () => {
      // When
      const error = RedisOperationError.fromCommand('SET', ['key', 'value', 'EX', 3600]);

      // Then
      expect(error.message).toContain('SET');
      expect(error.command).toBe('SET');
      expect(error.context?.argsCount).toBe(4);
    });

    it('should create from command and args with cause', () => {
      // Given
      const cause = new Error('Connection lost');

      // When
      const error = RedisOperationError.fromCommand('HSET', ['hash', 'field', 'value'], cause);

      // Then
      expect(error.message).toContain('HSET');
      expect(error.message).toContain('Connection lost');
      expect(error.command).toBe('HSET');
      expect(error.cause).toBe(cause);
      expect(error.context?.argsCount).toBe(3);
    });

    it('should create from command and args without cause', () => {
      // When
      const error = RedisOperationError.fromCommand('DEL', ['key1', 'key2']);

      // Then
      expect(error.message).toContain('DEL');
      expect(error.message).toContain('Unknown error');
      expect(error.context?.argsCount).toBe(2);
    });
  });

  describe('RedisKeyNotFoundError', () => {
    it('should create key not found error', () => {
      // When
      const error = new RedisKeyNotFoundError('user:123', 'GET');

      // Then
      expect(error.code).toBe(ErrorCode.OP_KEY_NOT_FOUND);
      expect(error.message).toContain('user:123');
      expect(error.key).toBe('user:123');
      expect(error.command).toBe('GET');
    });
  });

  describe('RedisTypeMismatchError', () => {
    it('should create type mismatch error', () => {
      // When
      const error = new RedisTypeMismatchError('mykey', 'list', 'string', 'LPUSH');

      // Then
      expect(error.code).toBe(ErrorCode.OP_TYPE_MISMATCH);
      expect(error.message).toContain('mykey');
      expect(error.message).toContain('list');
      expect(error.message).toContain('string');
      expect(error.expected).toBe('list');
      expect(error.actual).toBe('string');
    });

    it('should create from Redis error', () => {
      // Given
      const redisError = new Error('WRONGTYPE Operation against a key holding the wrong kind of value');

      // When
      const error = RedisTypeMismatchError.fromRedisError('mykey', 'LPUSH', redisError);

      // Then
      expect(error.code).toBe(ErrorCode.OP_TYPE_MISMATCH);
      expect(error.expected).toBe('list');
      expect(error.cause).toBe(redisError);
    });

    it('should infer set type from SADD command', () => {
      // Given
      const redisError = new Error('WRONGTYPE Operation against a key holding the wrong kind of value');

      // When
      const error = RedisTypeMismatchError.fromRedisError('mykey', 'SADD', redisError);

      // Then
      expect(error.expected).toBe('set');
    });

    it('should infer zset type from ZADD command', () => {
      // Given
      const redisError = new Error('WRONGTYPE Operation against a key holding the wrong kind of value');

      // When
      const error = RedisTypeMismatchError.fromRedisError('mykey', 'ZADD', redisError);

      // Then
      expect(error.expected).toBe('zset');
    });

    it('should infer hash type from HSET command', () => {
      // Given
      const redisError = new Error('WRONGTYPE Operation against a key holding the wrong kind of value');

      // When
      const error = RedisTypeMismatchError.fromRedisError('mykey', 'HGET', redisError);

      // Then
      expect(error.expected).toBe('hash');
    });

    it('should handle RPOP for list type', () => {
      // Given
      const redisError = new Error('WRONGTYPE Operation against a key holding the wrong kind of value');

      // When
      const error = RedisTypeMismatchError.fromRedisError('mykey', 'RPOP', redisError);

      // Then
      expect(error.expected).toBe('list');
    });

    it('should handle BLPOP for list type', () => {
      // Given
      const redisError = new Error('WRONGTYPE Operation against a key holding the wrong kind of value');

      // When
      const error = RedisTypeMismatchError.fromRedisError('mykey', 'BLPOP', redisError);

      // Then
      expect(error.expected).toBe('list');
    });

    it('should return unknown for SET command', () => {
      // Given
      const redisError = new Error('WRONGTYPE Operation against a key holding the wrong kind of value');

      // When
      const error = RedisTypeMismatchError.fromRedisError('mykey', 'SET', redisError);

      // Then
      expect(error.expected).toBe('unknown');
    });

    it('should return unknown for non-WRONGTYPE error', () => {
      // Given
      const redisError = new Error('Some other error');

      // When
      const error = RedisTypeMismatchError.fromRedisError('mykey', 'LPUSH', redisError);

      // Then
      expect(error.expected).toBe('unknown');
      expect(error.actual).toBe('unknown');
    });
  });

  describe('RedisScriptError', () => {
    it('should create script error', () => {
      // When
      const error = new RedisScriptError('Script execution failed', 'abc123def456');

      // Then
      expect(error.code).toBe(ErrorCode.OP_SCRIPT_ERROR);
      expect(error.scriptSha).toBe('abc123def456');
    });

    it('should create timeout error', () => {
      // When
      const error = RedisScriptError.timeout(5000, 'abc123');

      // Then
      expect(error.message).toContain('5000ms');
      expect(error.scriptSha).toBe('abc123');
      expect(error.context?.timeoutMs).toBe(5000);
    });

    it('should create not found error', () => {
      // When
      const error = RedisScriptError.notFound('xyz789');

      // Then
      expect(error.message).toContain('not found');
      expect(error.scriptSha).toBe('xyz789');
      expect(error.context?.reason).toBe('NOSCRIPT');
    });
  });

  describe('RedisConfigError', () => {
    it('should create config error', () => {
      // When
      const error = RedisConfigError.create('Invalid config');

      // Then
      expect(error.code).toBe(ErrorCode.CFG_INVALID);
      expect(error.message).toBe('Invalid config');
    });

    it('should create missing required error', () => {
      // When
      const error = RedisConfigError.missingRequired('host', 'connection');

      // Then
      expect(error.code).toBe(ErrorCode.CFG_MISSING_REQUIRED);
      expect(error.message).toContain('connection.host');
      expect(error.context?.field).toBe('host');
      expect(error.context?.parent).toBe('connection');
    });

    it('should create invalid connection type error', () => {
      // When
      const error = RedisConfigError.invalidConnectionType('invalid', ['single', 'cluster', 'sentinel']);

      // Then
      expect(error.code).toBe(ErrorCode.CFG_INVALID_CONNECTION_TYPE);
      expect(error.message).toContain('invalid');
      expect(error.message).toContain('single');
    });

    it('should create invalid TTL error', () => {
      // When
      const error = RedisConfigError.invalidTTL(-1, 'Must be positive');

      // Then
      expect(error.code).toBe(ErrorCode.CFG_INVALID_TTL);
      expect(error.message).toContain('-1');
      expect(error.message).toContain('Must be positive');
    });

    it('should create driver not supported error', () => {
      // When
      const error = RedisConfigError.driverNotSupported('unknown', ['ioredis', 'node-redis']);

      // Then
      expect(error.code).toBe(ErrorCode.CFG_DRIVER_NOT_SUPPORTED);
      expect(error.message).toContain('unknown');
      expect(error.context?.supportedDrivers).toContain('ioredis');
    });

    it('should create invalid host/port error with reason', () => {
      // When
      const error = RedisConfigError.invalidHostPort('localhost', 9999, 'Port out of range');

      // Then
      expect(error.code).toBe(ErrorCode.CFG_INVALID_HOST_PORT);
      expect(error.message).toContain('Port out of range');
      expect(error.context?.host).toBe('localhost');
      expect(error.context?.port).toBe(9999);
    });

    it('should create invalid host/port error without reason', () => {
      // When
      const error = RedisConfigError.invalidHostPort('', 0);

      // Then
      expect(error.code).toBe(ErrorCode.CFG_INVALID_HOST_PORT);
      expect(error.message).toContain('Invalid host');
    });

    it('should create invalid database error', () => {
      // When
      const error = RedisConfigError.invalidDb(20, 15);

      // Then
      expect(error.code).toBe(ErrorCode.CFG_INVALID_DB);
      expect(error.message).toContain('20');
      expect(error.message).toContain('15');
      expect(error.context?.db).toBe(20);
      expect(error.context?.max).toBe(15);
    });

    it('should create invalid timeout error with reason', () => {
      // When
      const error = RedisConfigError.invalidTimeout(-1000, 'connect', 'Must be positive');

      // Then
      expect(error.code).toBe(ErrorCode.CFG_INVALID_TIMEOUT);
      expect(error.message).toContain('connect');
      expect(error.message).toContain('-1000');
      expect(error.message).toContain('Must be positive');
    });

    it('should create invalid timeout error without reason', () => {
      // When
      const error = RedisConfigError.invalidTimeout(0, 'command');

      // Then
      expect(error.code).toBe(ErrorCode.CFG_INVALID_TIMEOUT);
      expect(error.message).toContain('command');
    });

    it('should create invalid retry configuration error', () => {
      // When
      const error = RedisConfigError.invalidRetry('maxRetries must be positive', { maxRetries: -1 });

      // Then
      expect(error.code).toBe(ErrorCode.CFG_INVALID_RETRY);
      expect(error.message).toContain('maxRetries must be positive');
      expect(error.context?.maxRetries).toBe(-1);
    });

    it('should create incompatible configuration error with reason', () => {
      // When
      const error = RedisConfigError.incompatible('lazyConnect', 'autoConnect', 'Cannot use both');

      // Then
      expect(error.code).toBe(ErrorCode.CFG_INCOMPATIBLE);
      expect(error.message).toContain('lazyConnect');
      expect(error.message).toContain('autoConnect');
      expect(error.message).toContain('Cannot use both');
    });

    it('should create incompatible configuration error without reason', () => {
      // When
      const error = RedisConfigError.incompatible('option1', 'option2');

      // Then
      expect(error.code).toBe(ErrorCode.CFG_INCOMPATIBLE);
      expect(error.message).toContain('incompatible');
    });

    it('should create invalid cluster nodes error', () => {
      // When
      const nodes = [{ host: 'node1', port: 7000 }];
      const error = RedisConfigError.invalidClusterNodes('At least 3 nodes required', nodes);

      // Then
      expect(error.code).toBe(ErrorCode.CFG_INVALID_CLUSTER_NODES);
      expect(error.message).toContain('At least 3 nodes required');
      expect(error.context?.nodeCount).toBe(1);
    });

    it('should create invalid sentinel configuration error', () => {
      // When
      const error = RedisConfigError.invalidSentinel('Missing master name', { sentinels: [] });

      // Then
      expect(error.code).toBe(ErrorCode.CFG_INVALID_SENTINEL);
      expect(error.message).toContain('Missing master name');
    });

    it('should create invalid TLS configuration error', () => {
      // When
      const error = RedisConfigError.invalidTLS('Certificate file not found', { certPath: '/invalid' });

      // Then
      expect(error.code).toBe(ErrorCode.CFG_INVALID_TLS);
      expect(error.message).toContain('Certificate file not found');
      expect(error.context?.certPath).toBe('/invalid');
    });
  });

  describe('RedisValidationError', () => {
    it('should create single validation error', () => {
      // When
      const error = RedisValidationError.single('host', 'Host is required', 'localhost');

      // Then
      expect(error.code).toBe(ErrorCode.CFG_VALIDATION_FAILED);
      expect(error.field).toBe('host');
      expect(error.errors).toHaveLength(1);
      expect(error.errors[0].field).toBe('host');
      expect(error.errors[0].message).toBe('Host is required');
      expect(error.errors[0].value).toBe('localhost');
    });

    it('should create multiple validation errors', () => {
      // When
      const error = RedisValidationError.multiple('connection', [
        { field: 'host', message: 'Host is required' },
        { field: 'port', message: 'Port must be positive', value: -1 },
      ]);

      // Then
      expect(error.field).toBe('connection');
      expect(error.errors).toHaveLength(2);
    });

    it('should add errors', () => {
      // Given
      const error = RedisValidationError.single('config', 'Invalid');

      // When
      error.addError('host', 'Required');
      error.addError('port', 'Invalid', 0);

      // Then
      expect(error.errors).toHaveLength(3);
      expect(error.hasErrors()).toBe(true);
    });

    it('should get messages', () => {
      // Given
      const error = RedisValidationError.multiple('config', [
        { field: 'host', message: 'Required' },
        { field: 'port', message: 'Invalid' },
      ]);

      // When
      const messages = error.getMessages();

      // Then
      expect(messages).toContain('host: Required');
      expect(messages).toContain('port: Invalid');
    });

    it('should get field errors', () => {
      // Given
      const error = RedisValidationError.multiple('config', [
        { field: 'host', message: 'Required' },
        { field: 'port', message: 'Invalid' },
        { field: 'host', message: 'Must be string' },
      ]);

      // When
      const hostErrors = error.getFieldErrors('host');

      // Then
      expect(hostErrors).toHaveLength(2);
      expect(hostErrors.every((e) => e.field === 'host')).toBe(true);
    });
  });

  describe('ValidationErrorCollector', () => {
    it('should collect validation errors', () => {
      // Given
      const collector = new ValidationErrorCollector('connection');

      // When
      collector.add('host', 'Host is required');
      collector.add('port', 'Port must be positive', -1);

      // Then
      expect(collector.hasErrors()).toBe(true);
      expect(collector.count()).toBe(2);
    });

    it('should throw if errors exist', () => {
      // Given
      const collector = new ValidationErrorCollector('connection');
      collector.add('host', 'Required');

      // When/Then
      expect(() => collector.throwIfErrors()).toThrow(RedisValidationError);
    });

    it('should not throw if no errors', () => {
      // Given
      const collector = new ValidationErrorCollector('connection');

      // When/Then
      expect(() => collector.throwIfErrors()).not.toThrow();
    });

    it('should clear errors', () => {
      // Given
      const collector = new ValidationErrorCollector('connection');
      collector.add('host', 'Required');

      // When
      collector.clear();

      // Then
      expect(collector.hasErrors()).toBe(false);
      expect(collector.count()).toBe(0);
    });

    it('should get all errors', () => {
      // Given
      const collector = new ValidationErrorCollector('connection');
      collector.add('host', 'Required');
      collector.add('port', 'Invalid', 0);

      // When
      const errors = collector.getErrors();

      // Then
      expect(errors).toHaveLength(2);
      expect(errors[0].field).toBe('host');
      expect(errors[1].field).toBe('port');
    });
  });

  describe('RedisTransactionError', () => {
    it('should create transaction error', () => {
      // When
      const error = new RedisTransactionError('Transaction failed');

      // Then
      expect(error.code).toBe(ErrorCode.OP_TRANSACTION_FAILED);
      expect(error.command).toBe('EXEC');
      expect(error.message).toContain('Transaction failed');
    });

    it('should create aborted transaction error', () => {
      // When
      const error = RedisTransactionError.aborted();

      // Then
      expect(error.code).toBe(ErrorCode.OP_TRANSACTION_FAILED);
      expect(error.message).toContain('watched key was modified');
      expect(error.context?.reason).toBe('WATCH');
    });
  });

  describe('RedisPipelineError', () => {
    it('should create pipeline error with command counts', () => {
      // When
      const error = new RedisPipelineError('Pipeline failed', 10, 3);

      // Then
      expect(error.code).toBe(ErrorCode.OP_PIPELINE_FAILED);
      expect(error.command).toBe('PIPELINE');
      expect(error.totalCommands).toBe(10);
      expect(error.failedCommands).toBe(3);
      expect(error.context?.totalCommands).toBe(10);
      expect(error.context?.failedCommands).toBe(3);
    });
  });

  describe('RedisInvalidArgsError', () => {
    it('should create invalid args error', () => {
      // When
      const error = new RedisInvalidArgsError('SET', 'TTL must be positive', { ttl: -1 });

      // Then
      expect(error.code).toBe(ErrorCode.OP_INVALID_ARGS);
      expect(error.command).toBe('SET');
      expect(error.message).toContain('SET');
      expect(error.message).toContain('TTL must be positive');
      expect(error.args?.ttl).toBe(-1);
      expect(error.context?.reason).toBe('TTL must be positive');
    });
  });

  describe('RedisClusterError Factory Methods', () => {
    it('should create cluster down error', () => {
      // When
      const error = RedisClusterError.clusterDown('localhost', 7000);

      // Then
      expect(error.code).toBe(ErrorCode.CONN_CLUSTER_DOWN);
      expect(error.message).toContain('cluster is down');
      expect(error.host).toBe('localhost');
      expect(error.port).toBe(7000);
    });

    it('should create cluster down error without host/port', () => {
      // When
      const error = RedisClusterError.clusterDown();

      // Then
      expect(error.code).toBe(ErrorCode.CONN_CLUSTER_DOWN);
      expect(error.message).toContain('cluster is down');
    });

    it('should create MOVED redirection error', () => {
      // When
      const error = RedisClusterError.moved(1234, 'node2', 7001);

      // Then
      expect(error.code).toBe(ErrorCode.CONN_CLUSTER_MOVED);
      expect(error.message).toContain('Slot 1234');
      expect(error.message).toContain('node2:7001');
      expect(error.host).toBe('node2');
      expect(error.port).toBe(7001);
      expect(error.context?.slot).toBe(1234);
      expect(error.context?.targetHost).toBe('node2');
      expect(error.context?.targetPort).toBe(7001);
    });

    it('should create ASK redirection error', () => {
      // When
      const error = RedisClusterError.ask(5678, 'node3', 7002);

      // Then
      expect(error.code).toBe(ErrorCode.CONN_CLUSTER_ASK);
      expect(error.message).toContain('ASK redirection');
      expect(error.message).toContain('slot 5678');
      expect(error.message).toContain('node3:7002');
      expect(error.host).toBe('node3');
      expect(error.port).toBe(7002);
      expect(error.context?.slot).toBe(5678);
    });

    it('should create generic cluster error', () => {
      // When
      const cause = new Error('Network error');
      const error = RedisClusterError.generic('Cluster node unreachable', 'localhost', 7003, cause);

      // Then
      expect(error.code).toBe(ErrorCode.CONN_CLUSTER_ERROR);
      expect(error.message).toBe('Cluster node unreachable');
      expect(error.host).toBe('localhost');
      expect(error.port).toBe(7003);
      expect(error.cause).toBe(cause);
    });

    it('should create generic cluster error without host/port/cause', () => {
      // When
      const error = RedisClusterError.generic('Generic cluster issue');

      // Then
      expect(error.code).toBe(ErrorCode.CONN_CLUSTER_ERROR);
      expect(error.message).toBe('Generic cluster issue');
    });
  });

  describe('RedisSentinelError Factory Methods', () => {
    it('should create no master error with sentinels list', () => {
      // Given
      const sentinels = [
        { host: 'sentinel1', port: 26379 },
        { host: 'sentinel2', port: 26379 },
      ];

      // When
      const error = RedisSentinelError.noMaster('mymaster', sentinels);

      // Then
      expect(error.code).toBe(ErrorCode.CONN_SENTINEL_NO_MASTER);
      expect(error.message).toContain('No master found');
      expect(error.message).toContain('mymaster');
      expect(error.masterName).toBe('mymaster');
      expect(error.context?.sentinels).toEqual(sentinels);
    });

    it('should create no master error without sentinels list', () => {
      // When
      const error = RedisSentinelError.noMaster('mymaster');

      // Then
      expect(error.code).toBe(ErrorCode.CONN_SENTINEL_NO_MASTER);
      expect(error.message).toContain('No master found');
      expect(error.masterName).toBe('mymaster');
    });

    it('should create failover error with old and new master', () => {
      // When
      const error = RedisSentinelError.failover('mymaster', 'old:6379', 'new:6379');

      // Then
      expect(error.code).toBe(ErrorCode.CONN_SENTINEL_FAILOVER);
      expect(error.message).toContain('Sentinel failover');
      expect(error.message).toContain('mymaster');
      expect(error.masterName).toBe('mymaster');
      expect(error.context?.oldMaster).toBe('old:6379');
      expect(error.context?.newMaster).toBe('new:6379');
    });

    it('should create failover error without old/new master info', () => {
      // When
      const error = RedisSentinelError.failover('mymaster');

      // Then
      expect(error.code).toBe(ErrorCode.CONN_SENTINEL_FAILOVER);
      expect(error.message).toContain('Sentinel failover');
      expect(error.masterName).toBe('mymaster');
    });

    it('should create generic sentinel error', () => {
      // Given
      const cause = new Error('Sentinel connection failed');

      // When
      const error = RedisSentinelError.generic('Cannot connect to sentinels', 'mymaster', cause);

      // Then
      expect(error.code).toBe(ErrorCode.CONN_SENTINEL_ERROR);
      expect(error.message).toBe('Cannot connect to sentinels');
      expect(error.masterName).toBe('mymaster');
      expect(error.cause).toBe(cause);
    });

    it('should create generic sentinel error without master name or cause', () => {
      // When
      const error = RedisSentinelError.generic('Generic sentinel issue');

      // Then
      expect(error.code).toBe(ErrorCode.CONN_SENTINEL_ERROR);
      expect(error.message).toBe('Generic sentinel issue');
    });
  });

  describe('RedisOutOfMemoryError', () => {
    it('should create OOM error with key', () => {
      // When
      const error = new RedisOutOfMemoryError('SET', 'user:123');

      // Then
      expect(error.code).toBe(ErrorCode.OP_OUT_OF_MEMORY);
      expect(error.message).toContain('out of memory');
      expect(error.message).toContain('SET');
      expect(error.message).toContain('user:123');
      expect(error.command).toBe('SET');
      expect(error.key).toBe('user:123');
      expect(error.context?.key).toBe('user:123');
    });

    it('should create OOM error without key', () => {
      // When
      const error = new RedisOutOfMemoryError('ZADD');

      // Then
      expect(error.code).toBe(ErrorCode.OP_OUT_OF_MEMORY);
      expect(error.message).toContain('out of memory');
      expect(error.message).toContain('ZADD');
      expect(error.command).toBe('ZADD');
    });

    it('should create OOM error with cause', () => {
      // Given
      const cause = new Error('OOM command not allowed');

      // When
      const error = new RedisOutOfMemoryError('LPUSH', 'queue:events', cause);

      // Then
      expect(error.cause).toBe(cause);
    });
  });

  describe('RedisReadOnlyError', () => {
    it('should create read-only error with key', () => {
      // When
      const error = new RedisReadOnlyError('SET', 'user:456');

      // Then
      expect(error.code).toBe(ErrorCode.OP_READONLY);
      expect(error.message).toContain('read-only replica');
      expect(error.message).toContain('SET');
      expect(error.message).toContain('user:456');
      expect(error.command).toBe('SET');
      expect(error.key).toBe('user:456');
      expect(error.context?.key).toBe('user:456');
    });

    it('should create read-only error without key', () => {
      // When
      const error = new RedisReadOnlyError('DEL');

      // Then
      expect(error.code).toBe(ErrorCode.OP_READONLY);
      expect(error.message).toContain('read-only replica');
      expect(error.message).toContain('DEL');
      expect(error.command).toBe('DEL');
    });

    it('should create read-only error with cause', () => {
      // Given
      const cause = new Error("READONLY You can't write against a read only replica");

      // When
      const error = new RedisReadOnlyError('HSET', 'hash:data', cause);

      // Then
      expect(error.cause).toBe(cause);
    });
  });

  describe('RedisNotSupportedError', () => {
    it('should create not supported error', () => {
      // When
      const error = new RedisNotSupportedError('GEOSEARCH', 'Requires Redis 6.2+');

      // Then
      expect(error.code).toBe(ErrorCode.OP_NOT_SUPPORTED);
      expect(error.message).toContain('GEOSEARCH');
      expect(error.message).toContain('not supported');
      expect(error.message).toContain('Requires Redis 6.2+');
      expect(error.command).toBe('GEOSEARCH');
      expect(error.reason).toBe('Requires Redis 6.2+');
      expect(error.context?.reason).toBe('Requires Redis 6.2+');
    });

    it('should create not supported error for driver limitation', () => {
      // When
      const error = new RedisNotSupportedError('CLIENT TRACKING', 'Not supported by node-redis driver');

      // Then
      expect(error.code).toBe(ErrorCode.OP_NOT_SUPPORTED);
      expect(error.message).toContain('CLIENT TRACKING');
      expect(error.reason).toBe('Not supported by node-redis driver');
    });
  });

  describe('RedisNotConnectedError', () => {
    it('should create not connected error with command', () => {
      // When
      const error = new RedisNotConnectedError('GET');

      // Then
      expect(error.code).toBe(ErrorCode.OP_NOT_CONNECTED);
      expect(error.message).toContain('Cannot execute GET');
      expect(error.message).toContain('not connected');
      expect(error.command).toBe('GET');
    });

    it('should create not connected error without command', () => {
      // When
      const error = new RedisNotConnectedError();

      // Then
      expect(error.code).toBe(ErrorCode.OP_NOT_CONNECTED);
      expect(error.message).toContain('Cannot execute operation');
      expect(error.message).toContain('not connected');
    });
  });

  describe('RedisAuthError', () => {
    it('should create auth error with default message', () => {
      // When
      const error = new RedisAuthError();

      // Then
      expect(error.code).toBe(ErrorCode.CONN_AUTH_FAILED);
      expect(error.message).toContain('authentication failed');
    });

    it('should create auth error with custom message', () => {
      // When
      const error = new RedisAuthError('Invalid password', 'localhost', 6379);

      // Then
      expect(error.code).toBe(ErrorCode.CONN_AUTH_FAILED);
      expect(error.message).toBe('Invalid password');
      expect(error.host).toBe('localhost');
      expect(error.port).toBe(6379);
    });

    it('should create auth error with cause', () => {
      // Given
      const cause = new Error('WRONGPASS invalid username-password pair');

      // When
      const error = new RedisAuthError('Auth failed', 'redis.example.com', 6380, cause);

      // Then
      expect(error.cause).toBe(cause);
      expect(error.host).toBe('redis.example.com');
      expect(error.port).toBe(6380);
    });
  });

  describe('RedisTLSError', () => {
    it('should create TLS error with default message', () => {
      // When
      const error = new RedisTLSError();

      // Then
      expect(error.code).toBe(ErrorCode.CONN_TLS_ERROR);
      expect(error.message).toContain('TLS/SSL connection failed');
    });

    it('should create TLS error with custom message', () => {
      // When
      const error = new RedisTLSError('Certificate verification failed', 'secure.redis.com', 6380);

      // Then
      expect(error.code).toBe(ErrorCode.CONN_TLS_ERROR);
      expect(error.message).toBe('Certificate verification failed');
      expect(error.host).toBe('secure.redis.com');
      expect(error.port).toBe(6380);
    });

    it('should create TLS error with cause', () => {
      // Given
      const cause = new Error('DEPTH_ZERO_SELF_SIGNED_CERT');

      // When
      const error = new RedisTLSError('TLS handshake failed', 'localhost', 6380, cause);

      // Then
      expect(error.cause).toBe(cause);
    });
  });

  describe('RedisMaxRetriesError', () => {
    it('should create max retries error', () => {
      // When
      const error = new RedisMaxRetriesError(5, 'localhost', 6379);

      // Then
      expect(error.code).toBe(ErrorCode.CONN_MAX_RETRIES);
      expect(error.message).toContain('Maximum connection retries');
      expect(error.message).toContain('5');
      expect(error.maxRetries).toBe(5);
      expect(error.host).toBe('localhost');
      expect(error.port).toBe(6379);
      expect(error.context?.maxRetries).toBe(5);
    });

    it('should create max retries error with cause', () => {
      // Given
      const cause = new Error('ECONNREFUSED');

      // When
      const error = new RedisMaxRetriesError(3, 'redis.example.com', 6380, cause);

      // Then
      expect(error.maxRetries).toBe(3);
      expect(error.cause).toBe(cause);
    });

    it('should create max retries error without host/port', () => {
      // When
      const error = new RedisMaxRetriesError(10);

      // Then
      expect(error.code).toBe(ErrorCode.CONN_MAX_RETRIES);
      expect(error.maxRetries).toBe(10);
      expect(error.message).toContain('10');
    });
  });

  describe('RedisPoolExhaustedError', () => {
    it('should create pool exhausted error', () => {
      // When
      const error = new RedisPoolExhaustedError(10, 100);

      // Then
      expect(error.code).toBe(ErrorCode.CONN_POOL_EXHAUSTED);
      expect(error.message).toContain('Connection pool exhausted');
      expect(error.message).toContain('size: 10');
      expect(error.message).toContain('waiting: 100');
      expect(error.poolSize).toBe(10);
      expect(error.waitingClients).toBe(100);
      expect(error.context?.poolSize).toBe(10);
      expect(error.context?.waitingClients).toBe(100);
    });

    it('should create pool exhausted error with cause', () => {
      // Given
      const cause = new Error('Pool timeout');

      // When
      const error = new RedisPoolExhaustedError(5, 50, cause);

      // Then
      expect(error.poolSize).toBe(5);
      expect(error.waitingClients).toBe(50);
      expect(error.cause).toBe(cause);
    });

    it('should create pool exhausted error with zero waiting clients', () => {
      // When
      const error = new RedisPoolExhaustedError(20, 0);

      // Then
      expect(error.poolSize).toBe(20);
      expect(error.waitingClients).toBe(0);
      expect(error.message).toContain('waiting: 0');
    });
  });

  describe('Utility Functions', () => {
    describe('isErrorCode', () => {
      it('should return true for valid connection error codes', () => {
        // When/Then
        expect(isErrorCode(ErrorCode.CONN_FAILED)).toBe(true);
        expect(isErrorCode(ErrorCode.CONN_TIMEOUT)).toBe(true);
        expect(isErrorCode(ErrorCode.CONN_AUTH_FAILED)).toBe(true);
      });

      it('should return true for valid operation error codes', () => {
        // When/Then
        expect(isErrorCode(ErrorCode.OP_FAILED)).toBe(true);
        expect(isErrorCode(ErrorCode.OP_TIMEOUT)).toBe(true);
        expect(isErrorCode(ErrorCode.OP_KEY_NOT_FOUND)).toBe(true);
      });

      it('should return true for valid config error codes', () => {
        // When/Then
        expect(isErrorCode(ErrorCode.CFG_INVALID)).toBe(true);
        expect(isErrorCode(ErrorCode.CFG_MISSING_REQUIRED)).toBe(true);
      });

      it('should return false for invalid error codes', () => {
        // When/Then
        expect(isErrorCode('INVALID_CODE')).toBe(false);
        expect(isErrorCode('NOT_AN_ERROR')).toBe(false);
        expect(isErrorCode('')).toBe(false);
        expect(isErrorCode('random string')).toBe(false);
      });
    });

    describe('getErrorDomain', () => {
      it('should extract domain from connection error code', () => {
        // When
        const domain = getErrorDomain(ErrorCode.CONN_FAILED);

        // Then
        expect(domain).toBe('CONN');
      });

      it('should extract domain from operation error code', () => {
        // When
        const domain = getErrorDomain(ErrorCode.OP_FAILED);

        // Then
        expect(domain).toBe('OP');
      });

      it('should extract domain from config error code', () => {
        // When
        const domain = getErrorDomain(ErrorCode.CFG_INVALID);

        // Then
        expect(domain).toBe('CFG');
      });

      it('should extract domain from cluster error code', () => {
        // When
        const domain = getErrorDomain(ErrorCode.CONN_CLUSTER_DOWN);

        // Then
        expect(domain).toBe('CONN');
      });

      it('should handle unknown error code', () => {
        // When
        const domain = getErrorDomain(ErrorCode.UNKNOWN);

        // Then
        expect(domain).toBe('UNKNOWN');
      });

      it('should handle error code without underscore', () => {
        // When - simulate error code without underscore
        const domain = getErrorDomain('NOUNDERCORE' as ErrorCode);

        // Then
        expect(domain).toBe('NOUNDERCORE');
      });

      it('should return UNKNOWN for empty string', () => {
        // When - simulate empty error code
        const domain = getErrorDomain('' as ErrorCode);

        // Then
        expect(domain).toBe('UNKNOWN');
      });
    });

    describe('isErrorDomain', () => {
      it('should return true when error code belongs to domain', () => {
        // When/Then
        expect(isErrorDomain(ErrorCode.CONN_FAILED, 'CONN')).toBe(true);
        expect(isErrorDomain(ErrorCode.CONN_TIMEOUT, 'CONN')).toBe(true);
        expect(isErrorDomain(ErrorCode.OP_FAILED, 'OP')).toBe(true);
        expect(isErrorDomain(ErrorCode.CFG_INVALID, 'CFG')).toBe(true);
      });

      it('should return false when error code does not belong to domain', () => {
        // When/Then
        expect(isErrorDomain(ErrorCode.CONN_FAILED, 'OP')).toBe(false);
        expect(isErrorDomain(ErrorCode.OP_FAILED, 'CFG')).toBe(false);
        expect(isErrorDomain(ErrorCode.CFG_INVALID, 'CONN')).toBe(false);
      });

      it('should handle UNKNOWN error code', () => {
        // When/Then
        expect(isErrorDomain(ErrorCode.UNKNOWN, 'UNKNOWN')).toBe(true);
        expect(isErrorDomain(ErrorCode.UNKNOWN, 'CONN')).toBe(false);
      });

      it('should be case sensitive', () => {
        // When/Then
        expect(isErrorDomain(ErrorCode.CONN_FAILED, 'conn')).toBe(false);
        expect(isErrorDomain(ErrorCode.CONN_FAILED, 'CONN')).toBe(true);
      });
    });
  });
});
