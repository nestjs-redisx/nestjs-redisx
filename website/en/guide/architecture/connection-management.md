---
title: Connection Management
description: Connection pools, timeouts, and retry configuration
---

# Connection Management

Proper connection configuration is critical for production reliability.

## Connection Pool Sizing

### Formula

```
pool_size = (concurrent_requests × redis_ops_per_request) / ops_per_connection_per_second
```

### Guidelines

| Application Size | Min Pool | Max Pool |
|------------------|----------|----------|
| Small (<100 RPS) | 5 | 10 |
| Medium (100-1000 RPS) | 10 | 50 |
| Large (1000-10000 RPS) | 50 | 200 |

```typescript
RedisModule.forRoot({
  clients: {
    host: 'redis',
    port: 6379,
    // Connection pool settings
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    // ioredis doesn't have traditional pool
    // It uses single connection with pipelining
    // For true pooling, use multiple clients
  },
})
```

### Multiple Clients Pattern

```typescript
RedisModule.forRoot({
  clients: {
    default: {
      host: 'redis',
      port: 6379,
    },
    cache: {
      host: 'redis-cache',
      port: 6379,
    },
    locks: {
      host: 'redis-locks',
      port: 6379,
    },
  },
})
```

## Timeout Configuration

### Timeout Types

| Timeout | Default | Purpose |
|---------|---------|---------|
| Connect | 10s | Initial connection |
| Command | 0 (none) | Individual command |
| Socket | 0 (none) | Network socket |

```typescript
{
  host: 'redis',
  port: 6379,
  connectTimeout: 10000,    // 10 seconds
  commandTimeout: 5000,     // 5 seconds per command
  // For socket timeout, use network-level config
}
```

### Recommended Timeouts

| Environment | Connect | Command |
|-------------|---------|---------|
| Local dev | 5s | None |
| Cloud (same region) | 10s | 5s |
| Cross-region | 30s | 10s |

## Retry Strategy

### Exponential Backoff

```typescript
{
  retryStrategy: (times) => {
    if (times > 10) {
      // Stop retrying after 10 attempts
      return null;
    }
    // Exponential backoff: 100, 200, 400, 800, 1600, 3000, 3000...
    return Math.min(times * 100, 3000);
  },
}
```

### With Jitter

```typescript
{
  retryStrategy: (times) => {
    if (times > 10) return null;
    const delay = Math.min(times * 100, 3000);
    // Add ±20% jitter
    return delay + (Math.random() - 0.5) * delay * 0.4;
  },
}
```

## Keep-Alive

Prevent connection drops in cloud environments:

```typescript
{
  host: 'redis',
  port: 6379,
  keepAlive: 30000,  // Send keepalive every 30s
  noDelay: true,     // Disable Nagle's algorithm
}
```

## TLS Configuration

```typescript
{
  host: 'redis',
  port: 6379,
  tls: {
    // For self-signed certs
    rejectUnauthorized: false,
    // Or with CA
    ca: fs.readFileSync('ca.crt'),
  },
}
```

## Sentinel Configuration

```typescript
{
  sentinels: [
    { host: 'sentinel-1', port: 26379 },
    { host: 'sentinel-2', port: 26379 },
    { host: 'sentinel-3', port: 26379 },
  ],
  name: 'mymaster',
  sentinelPassword: 'sentinel-password',
  password: 'redis-password',
}
```

## Cluster Configuration

```typescript
{
  // ioredis cluster mode
  startupNodes: [
    { host: 'node-1', port: 6379 },
    { host: 'node-2', port: 6379 },
    { host: 'node-3', port: 6379 },
  ],
  redisOptions: {
    password: 'password',
  },
  scaleReads: 'slave',  // Read from replicas
}
```

## Connection Events

```typescript
@Injectable()
export class RedisEventListener implements OnModuleInit {
  constructor(@InjectRedis() private redis: Redis) {}

  onModuleInit() {
    this.redis.on('connect', () => {
      this.logger.log('Redis connected');
    });

    this.redis.on('ready', () => {
      this.logger.log('Redis ready');
    });

    this.redis.on('error', (err) => {
      this.logger.error('Redis error', err);
    });

    this.redis.on('close', () => {
      this.logger.warn('Redis connection closed');
    });

    this.redis.on('reconnecting', () => {
      this.logger.log('Redis reconnecting');
    });
  }
}
```

## Monitoring Connections

```yaml
# Active connections
redis_connected_clients

# Connection pool utilization (if using pool)
redis_pool_active / redis_pool_max

# Connection errors
rate(redis_connection_errors_total[5m])

# Command latency
histogram_quantile(0.99, redis_command_duration_seconds)
```

## Troubleshooting

| Symptom | Possible Cause | Solution |
|---------|----------------|----------|
| Connection timeout | Network/firewall | Check connectivity |
| Command timeout | Slow command/load | Check slow log |
| Connection refused | Redis down | Check Redis status |
| Too many connections | Pool exhausted | Increase pool size |

## Next Steps

- [Deployment](./deployment) — Topology selection
- [Tuning](./tuning) — Performance optimization
