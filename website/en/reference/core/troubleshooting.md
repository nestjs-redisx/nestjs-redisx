---
title: Troubleshooting
description: Common issues and solutions for Core module
---

# Troubleshooting

Common issues and how to fix them.

## Connection Issues

### Cannot Connect to Redis

**Symptoms:**
- `ECONNREFUSED` error
- Timeout on connection
- Application hangs on startup

**Solutions:**

1. **Check Redis is running:**
```bash
redis-cli ping
# Should return: PONG
```

2. **Verify host and port:**
```typescript
RedisModule.forRoot({
  clients: {
    host: 'localhost',  // Correct host?
    port: 6379,         // Correct port?
  },
})
```

3. **Check network access:**
```bash
# Test connectivity
telnet localhost 6379

# Or with nc
nc -zv localhost 6379
```

4. **Docker networking:**
```typescript
// Inside Docker, use service name
RedisModule.forRoot({
  clients: {
    host: 'redis',  // Docker service name
    port: 6379,
  },
})
```

### Authentication Failed

**Symptoms:**
- `NOAUTH Authentication required`
- `ERR invalid password`

**Solutions:**

```typescript
RedisModule.forRoot({
  clients: {
    host: 'localhost',
    port: 6379,
    password: process.env.REDIS_PASSWORD,  // Add password
  },
})
```

### TLS Connection Failed

**Symptoms:**
- `UNABLE_TO_VERIFY_LEAF_SIGNATURE`
- `SELF_SIGNED_CERT_IN_CHAIN`
- Connection timeout with TLS

**Solutions:**

```typescript
RedisModule.forRoot({
  clients: {
    host: 'redis.example.com',
    port: 6380,
    tls: {
      enabled: true,
      rejectUnauthorized: false,  // Development only!
    },
  },
})

// Production with proper certificates
RedisModule.forRoot({
  clients: {
    host: 'redis.example.com',
    port: 6380,
    tls: {
      enabled: true,
      ca: fs.readFileSync('/path/to/ca.crt'),
      cert: fs.readFileSync('/path/to/client.crt'),
      key: fs.readFileSync('/path/to/client.key'),
    },
  },
})
```

## Module Configuration Issues

### Client Not Found

**Symptoms:**
- `Client "xyz" not found`
- `Available clients: default`

**Solutions:**

1. **Check client name matches:**
```typescript
// Configuration
RedisModule.forRoot({
  clients: {
    cache: { host: 'localhost', port: 6379 },  // Named 'cache'
  },
})

// Usage — via RedisService
const client = await this.redis.getClient('cache');  // Must match

// Usage — via @InjectRedis decorator
@Injectable()
export class MyService {
  constructor(
    @InjectRedis('cache') private readonly cacheDriver: IRedisDriver,
  ) {}
}
```

2. **Verify multiple clients configured:**
```typescript
RedisModule.forRoot({
  clients: {
    default: { host: 'localhost', port: 6379 },
    cache: { host: 'cache-server', port: 6379 },
    sessions: { host: 'session-server', port: 6379 },
  },
})
```

3. **Using `@InjectRedis` with wrong name:**
```typescript
// ❌ Name doesn't match any configured client
@InjectRedis('redis-cache')  // No client named 'redis-cache'

// ✅ Use exact name from configuration
@InjectRedis('cache')  // Matches 'cache' key in clients
@InjectRedis()          // Uses 'default' client
```

### Module Not Initialized

**Symptoms:**
- `Cannot read property 'getClient' of undefined`
- `RedisService is not defined`

**Solutions:**

1. **Ensure module is imported:**
```typescript
@Module({
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
    }),
  ],
})
export class AppModule {}
```

2. **Check async configuration:**
```typescript
RedisModule.forRootAsync({
  imports: [ConfigModule],  // Import dependencies
  useFactory: (config: ConfigService) => ({
    clients: {
      host: config.get('REDIS_HOST'),
      port: config.get('REDIS_PORT'),
    },
  }),
  inject: [ConfigService],  // Inject dependencies
})
```

### Circular Dependency

**Symptoms:**
- `Nest cannot resolve dependencies`
- `A circular dependency has been detected`

**Solutions:**

```typescript
// Use forwardRef for circular dependencies
@Injectable()
export class ServiceA {
  constructor(
    @Inject(forwardRef(() => ServiceB))
    private readonly serviceB: ServiceB,
    private readonly redis: RedisService,
  ) {}
}
```

## Cluster Issues

### MOVED/ASK Redirections

**Symptoms:**
- `MOVED 12345 192.168.1.2:6379`
- `ASK 12345 192.168.1.2:6379`

**Solutions:**

```typescript
// Increase max redirections
RedisModule.forRoot({
  clients: {
    type: 'cluster',
    nodes: [...],
    clusterOptions: {
      maxRedirections: 32,  // Increase from default 16
    },
  },
})
```

### Cluster Down

**Symptoms:**
- `CLUSTERDOWN The cluster is down`
- Operations fail intermittently

**Solutions:**

```typescript
// Configure retry delays
RedisModule.forRoot({
  clients: {
    type: 'cluster',
    nodes: [...],
    clusterOptions: {
      retryDelayOnClusterDown: 300,  // Wait longer
      retryDelayOnFailover: 200,
    },
  },
})
```

### NAT/Docker Issues

**Symptoms:**
- Works initially, then fails
- `MOVED` to internal IP addresses

**Solutions:**

```typescript
// Use NAT mapping
RedisModule.forRoot({
  clients: {
    type: 'cluster',
    nodes: [
      { host: 'localhost', port: 7000 },
    ],
    clusterOptions: {
      natMap: {
        '172.17.0.2:6379': { host: 'localhost', port: 7000 },
        '172.17.0.3:6379': { host: 'localhost', port: 7001 },
        '172.17.0.4:6379': { host: 'localhost', port: 7002 },
      },
    },
  },
})
```

## Sentinel Issues

### Cannot Find Master

**Symptoms:**
- `Master not found`
- `Connection to sentinel failed`

**Solutions:**

```typescript
// Verify sentinel configuration
RedisModule.forRoot({
  clients: {
    type: 'sentinel',
    sentinels: [
      { host: 'sentinel-1', port: 26379 },
      { host: 'sentinel-2', port: 26379 },
      { host: 'sentinel-3', port: 26379 },
    ],
    name: 'mymaster',  // Must match sentinel config
  },
})
```

### Sentinel Authentication

**Solutions:**

```typescript
RedisModule.forRoot({
  clients: {
    type: 'sentinel',
    sentinels: [...],
    name: 'mymaster',
    password: 'redis-password',
    sentinelOptions: {
      sentinelPassword: 'sentinel-password',  // Separate password
    },
  },
})
```

## Plugin Issues

### Plugin Dependency Missing

**Symptoms:**
- `Plugin "audit" depends on "cache" which is not registered`

**Cause:** Plugin declares a dependency that isn't in the `plugins` array.

**Solutions:**

```typescript
// ❌ Missing dependency
RedisModule.forRoot({
  clients: { host: 'localhost', port: 6379 },
  plugins: [
    new AuditPlugin(),  // depends on 'cache', but CachePlugin not registered
  ],
})

// ✅ Register all dependencies
RedisModule.forRoot({
  clients: { host: 'localhost', port: 6379 },
  plugins: [
    new CachePlugin(),   // Must come before dependents
    new AuditPlugin(),   // Now 'cache' dependency is satisfied
  ],
})
```

::: tip
Plugin order in the array doesn't matter — the system automatically sorts by dependencies using topological sort. Just make sure all dependencies are present.
:::

### Circular Plugin Dependency

**Symptoms:**
- `Circular dependency detected among plugins: plugin-a, plugin-b`

**Cause:** Two or more plugins depend on each other, forming a cycle.

**Solutions:**

```typescript
// ❌ A depends on B, B depends on A
class PluginA implements IRedisXPlugin {
  readonly dependencies = ['plugin-b'];  // Circular!
}
class PluginB implements IRedisXPlugin {
  readonly dependencies = ['plugin-a'];  // Circular!
}

// ✅ Break the cycle — use moduleRef for optional cross-plugin access
class PluginA implements IRedisXPlugin {
  readonly dependencies = [];  // No hard dependency

  async onModuleInit(context: IPluginContext) {
    // Access plugin-b optionally
    if (context.hasPlugin('plugin-b')) {
      const pluginB = context.getPlugin('plugin-b');
    }
  }
}
```

### Plugin Service Not Injectable

**Symptoms:**
- `Nest can't resolve dependencies of MyService (?). Please make sure that the argument LOCK_SERVICE at index [0] is available`

**Cause:** Plugin not registered, or service token not exported.

**Solutions:**

1. **Ensure plugin is registered:**
```typescript
RedisModule.forRoot({
  clients: { host: 'localhost', port: 6379 },
  plugins: [
    new LocksPlugin(),  // Must be registered
  ],
})
```

2. **Use correct injection token:**
```typescript
import { LOCK_SERVICE, ILockService } from '@nestjs-redisx/locks';

@Injectable()
export class MyService {
  constructor(
    @Inject(LOCK_SERVICE) private readonly lockService: ILockService,
  ) {}
}
```

### Plugin Lifecycle Hook Errors

**Symptoms:**
- `Plugin registration failed`
- `Plugin initialization failed`
- Error during application startup

**Solutions:**

1. **Check plugin `onRegister`/`onModuleInit` for errors:**
```typescript
class MyPlugin implements IRedisXPlugin {
  async onModuleInit(context: IPluginContext) {
    try {
      // Your init logic
    } catch (error) {
      context.logger.error('Init failed', error);
      throw error;  // Let the system know
    }
  }
}
```

2. **Verify Redis is connected before accessing clients:**
```typescript
async onModuleInit(context: IPluginContext) {
  if (context.clientManager.hasClient('default')) {
    const client = await context.clientManager.getClient();
    // Safe to use client
  }
}
```

## Performance Issues

### High Latency

**Symptoms:**
- Slow Redis operations
- Timeouts on commands

**Solutions:**

1. **Check network latency:**
```bash
redis-cli --latency
```

2. **Use pipelining:**
```typescript
const pipeline = await this.redis.pipeline();
pipeline.get('key1');
pipeline.get('key2');
pipeline.get('key3');
const results = await pipeline.exec();
```

3. **Adjust timeouts:**
```typescript
RedisModule.forRoot({
  clients: {
    host: 'localhost',
    port: 6379,
    connectTimeout: 5000,   // Connection timeout
    commandTimeout: 3000,   // Command timeout
  },
})
```

### Memory Issues

**Symptoms:**
- `OOM command not allowed`
- Redis memory full

**Solutions:**

1. **Check Redis memory:**
```bash
redis-cli INFO memory
```

2. **Set TTL on keys:**
```typescript
await this.redis.set('key', 'value', { ex: 3600 });  // 1 hour TTL
```

3. **Monitor key count:**
```typescript
const keyCount = await this.redis.dbsize();
```

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `ECONNREFUSED` | Redis not running | Start Redis server |
| `NOAUTH` | Missing password | Add password to config |
| `WRONGPASS` | Invalid password | Check password in config |
| `WRONGTYPE` | Wrong data type | Check key type first |
| `MOVED` | Cluster redirect | Increase maxRedirections |
| `CLUSTERDOWN` | Cluster unavailable | Check cluster nodes, wait for recovery |
| `READONLY` | Writing to replica | Connect to master |
| `BUSYKEY` | Target key exists | Delete target key or use different name |
| `OOM` | Out of memory | Clear old keys, add memory |
| `Plugin "x" depends on "y"...` | Missing plugin dependency | Add required plugin to plugins array |
| `Circular dependency detected` | Plugins depend on each other | Break the cycle, use `hasPlugin()` instead |
| `Client "x" not found` | Wrong client name | Verify name matches config key |

## Debug Mode

Enable debug logging:

```typescript
RedisModule.forRoot({
  clients: { host: 'localhost', port: 6379 },
  global: {
    debug: true,  // Enable debug logging
  },
})
```

## Connection Test

<<< @/apps/demo/src/core/debug-service.usage.ts{typescript}

## Redis CLI Commands

```bash
# Check Redis is running
redis-cli ping

# Get server info
redis-cli INFO

# Monitor commands in real-time
redis-cli MONITOR

# Check memory usage
redis-cli INFO memory

# List all keys (use with caution)
redis-cli KEYS "*"

# Check cluster status
redis-cli CLUSTER INFO
redis-cli CLUSTER NODES

# Check sentinel status
redis-cli -p 26379 SENTINEL masters
```

## Getting Help

If you're still stuck:

1. Enable debug mode
2. Check Redis server logs
3. Verify network connectivity
4. Test with redis-cli
5. Review configuration
6. Check for typos in client names

## Next Steps

- [Configuration](./configuration) — Review configuration options
- [Plugin System](./plugin-system) — Plugin architecture and lifecycle
- [Error Handling](./error-handling) — Error codes and hierarchy
- [Health Monitoring](./health-monitoring) — Monitor connections
- [Connection Types](./connection-types) — Connection type details
