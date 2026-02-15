---
title: Health Monitoring
description: Connection health checks, auto-reconnection, and statistics
---

# Health Monitoring

Monitor Redis connections and handle failures gracefully.

## Connection Status

```typescript
enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error',
}
```

## Health Checks

### Single Client Health Check

<<< @/apps/demo/src/core/health-monitoring/health-service.usage.ts{typescript}

### All Clients Health Check

```typescript
async checkAllClients(): Promise<IHealthStatus[]> {
  return this.clientManager.healthCheck() as Promise<IHealthStatus[]>;
}
```

### Health Status Response

```typescript
interface IHealthStatus {
  name: string;
  healthy: boolean;
  status: ConnectionStatus;
  latency: number | null;      // Ping latency in ms
  lastError: string | null;
  lastCheckAt: Date;
  metadata: {
    driverType: string;
    connectionType: string;
    reconnectAttempts: number;
    uptime: number;            // Milliseconds
  };
}
```

## NestJS Terminus Integration

### Health Indicator

<<< @/apps/demo/src/core/health-monitoring/terminus-indicator.usage.ts{typescript}

### Health Controller

<<< @/apps/demo/src/core/health-monitoring/health-controller.usage.ts{typescript}

## Connection Statistics

### Get Stats

```typescript
const stats = this.clientManager.getStats();
```

### Stats Response

```typescript
interface IConnectionStats {
  totalClients: number;
  connectedClients: number;
  disconnectedClients: number;
  errorClients: number;
  clients: Record<string, IClientStats>;
  collectedAt: Date;
}

interface IClientStats {
  name: string;
  status: ConnectionStatus;
  commandsExecuted: number;
  errors: number;
  reconnections: number;
  averageLatency: number;
  peakLatency: number;
  lastActivityAt: Date | null;
  connectedAt: Date | null;
  uptime: number;
}
```

### Stats Endpoint

<<< @/apps/demo/src/core/health-monitoring/stats-endpoint.usage.ts{typescript}

## Auto-Reconnection

### Default Behavior

Automatic reconnection with exponential backoff:

- Initial delay: 1000ms
- Maximum delay: 30000ms
- Backoff multiplier: 2x
- Jitter: enabled (prevents thundering herd)
- Max attempts: unlimited

### Custom Reconnection Options

::: code-group

```typescript [ioredis]
await this.clientManager.createClient('custom', config, {
  reconnection: {
    maxAttempts: 10,
    initialDelay: 500,
    maxDelay: 10000,
    backoffMultiplier: 1.5,
    enableJitter: true,
  },
  driverType: 'ioredis',
  metadata: {
    name: 'custom',
    config,
    status: ConnectionStatus.DISCONNECTED,
    reconnectAttempts: 0,
  },
});
```

```typescript [node-redis]
await this.clientManager.createClient('custom', config, {
  reconnection: {
    maxAttempts: 10,
    initialDelay: 500,
    maxDelay: 10000,
    backoffMultiplier: 1.5,
    enableJitter: true,
  },
  driverType: 'node-redis',
  metadata: {
    name: 'custom',
    config,
    status: ConnectionStatus.DISCONNECTED,
    reconnectAttempts: 0,
  },
});
```

:::

### Reconnection Timeline

```
Attempt 1: 500ms (initial delay)
Attempt 2: 750ms (500 * 1.5)
Attempt 3: 1125ms (750 * 1.5)
Attempt 4: 1687ms (1125 * 1.5)
...
Attempt N: capped at 10000ms (max delay)
```

## Event Monitoring

### Manager Events

```typescript
import { ManagerEvent } from '@nestjs-redisx/core';

enum ManagerEvent {
  CONNECTED = 'manager:connected',
  DISCONNECTED = 'manager:disconnected',
  RECONNECTING = 'manager:reconnecting',
  ERROR = 'manager:error',
  CREATED = 'manager:created',
  REMOVED = 'manager:removed',
}
```

### Event Listener

<<< @/apps/demo/src/core/client-events.usage.ts{typescript}

### Prometheus Metrics

<<< @/apps/demo/src/core/health-monitoring/prometheus-metrics.usage.ts{typescript}

## Client Metadata

### Get Metadata

```typescript
const metadata = this.clientManager.getMetadata('default');
```

### Metadata Structure

```typescript
interface IClientMetadata {
  name: string;
  config: ConnectionConfig;
  status: ConnectionStatus;
  connectedAt?: Date;
  lastError?: Error;
  reconnectAttempts: number;
}
```

### Update Metadata

```typescript
this.clientManager.updateMetadata('default', {
  // Custom metadata fields
});
```

## Graceful Shutdown

### Automatic Cleanup

RedisModule handles cleanup automatically via NestJS lifecycle hooks:

```typescript
// In RedisService and RedisClientManager
async onModuleDestroy(): Promise<void> {
  await this.clientManager.closeAll();
}
```

### Manual Cleanup

```typescript
// Close specific client
await this.clientManager.closeClient('cache');

// Close all clients
await this.clientManager.closeAll();
```

### Shutdown Timeout

Configure graceful shutdown timeout:

```typescript
RedisModule.forRoot({
  clients: { ... },
  global: {
    gracefulShutdown: true,
    gracefulShutdownTimeout: 10000,  // 10 seconds
  },
})
```

## Best Practices

### Health Check Interval

<<< @/apps/demo/src/core/health-monitoring/periodic-monitor.usage.ts{typescript}

### Alert on Errors

```typescript
this.clientManager.on(ManagerEvent.ERROR, async (data) => {
  // Send alert
  await this.alertService.send({
    level: 'error',
    message: `Redis client '${data.name}' error`,
    error: data.error?.message,
  });
});
```

### Log Connection Changes

```typescript
this.clientManager.on(ManagerEvent.CONNECTED, (data) => {
  this.logger.log(`Connected: ${data.name}`);
});

this.clientManager.on(ManagerEvent.DISCONNECTED, (data) => {
  this.logger.warn(`Disconnected: ${data.name}`);
});
```

## Next Steps

- [Decorators](./decorators) — @InjectRedis usage
- [Driver Abstraction](./driver-abstraction) — ioredis vs node-redis
- [Troubleshooting](./troubleshooting) — Common issues
