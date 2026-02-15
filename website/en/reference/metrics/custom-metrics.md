---
title: Custom Metrics
description: Create and track custom application metrics
---

# Custom Metrics

Add custom metrics to track application-specific behavior.

## Inject Metrics Service

<<< @/apps/demo/src/plugins/metrics/service-counter.usage.ts{typescript}

## Counter

Track cumulative values that only increase.

### Register and Use Counter

<<< @/apps/demo/src/plugins/metrics/service-counter.usage.ts{typescript}

### Counter Methods

```typescript
// Increment by 1
this.metrics.incrementCounter('orders_created_total');

// Increment with labels
this.metrics.incrementCounter('orders_created_total', {
  status: 'completed',
});

// Increment by specific amount
this.metrics.incrementCounter('orders_created_total', {
  status: 'completed',
}, 5);
```

### Counter Examples

**Track API Requests:**

```typescript
onModuleInit(): void {
  this.metrics.registerCounter(
    'api_requests_total',
    'Total API requests',
    ['method', 'endpoint', 'status'],
  );
}

// Usage
this.metrics.incrementCounter('api_requests_total', {
  method: 'GET',
  endpoint: '/api/users',
  status: '200',
});
```

**Track Errors:**

```typescript
onModuleInit(): void {
  this.metrics.registerCounter(
    'errors_total',
    'Total errors',
    ['type', 'severity'],
  );
}

// Usage
try {
  await this.process();
} catch (error) {
  this.metrics.incrementCounter('errors_total', {
    type: error.name,
    severity: 'high',
  });
  throw error;
}
```

## Gauge

Track values that can go up or down.

### Register and Use Gauge

<<< @/apps/demo/src/plugins/metrics/service-gauge.usage.ts{typescript}

### Gauge Methods

```typescript
// Set to specific value
this.metrics.setGauge('queue_size', 42, { queue: 'orders' });

// Increment by 1
this.metrics.incrementGauge('queue_size', { queue: 'orders' });

// Increment by specific amount
this.metrics.incrementGauge('queue_size', { queue: 'orders' }, 5);

// Decrement by 1
this.metrics.decrementGauge('queue_size', { queue: 'orders' });

// Decrement by specific amount
this.metrics.decrementGauge('queue_size', { queue: 'orders' }, 3);
```

### Gauge Examples

**Track Active Connections:**

```typescript
onModuleInit(): void {
  this.metrics.registerGauge(
    'active_connections',
    'Currently active connections',
  );
}

// On connect
this.metrics.incrementGauge('active_connections');

// On disconnect
this.metrics.decrementGauge('active_connections');
```

**Track Memory Usage:**

```typescript
onModuleInit(): void {
  this.metrics.registerGauge(
    'memory_usage_bytes',
    'Memory usage in bytes',
    ['type'],
  );
}

setInterval(() => {
  const mem = process.memoryUsage();
  this.metrics.setGauge('memory_usage_bytes', mem.heapUsed, { type: 'heap_used' });
  this.metrics.setGauge('memory_usage_bytes', mem.heapTotal, { type: 'heap_total' });
  this.metrics.setGauge('memory_usage_bytes', mem.rss, { type: 'rss' });
}, 15000);
```

## Histogram

Track distribution of values (latency, sizes).

### Register and Use Histogram

<<< @/apps/demo/src/plugins/metrics/service-histogram.usage.ts{typescript}

### Histogram Methods

```typescript
// Start timer — returns a function that stops and records duration
const stopTimer = this.metrics.startTimer('payment_duration_seconds', {
  provider: 'stripe',
});

// ... do work ...

// Stop timer (records duration in seconds, returns duration)
const durationSeconds = stopTimer();

// Or observe value directly
this.metrics.observeHistogram('payment_duration_seconds', 1.234, {
  provider: 'stripe',
});
```

### Histogram Examples

**Track Request Size:**

```typescript
onModuleInit(): void {
  this.metrics.registerHistogram(
    'request_size_bytes',
    'HTTP request size in bytes',
    ['endpoint'],
    [100, 1000, 10000, 100000, 1000000],
  );
}

// Usage
this.metrics.observeHistogram(
  'request_size_bytes',
  req.body.length,
  { endpoint: '/api/upload' },
);
```

**Track Database Query Duration:**

```typescript
onModuleInit(): void {
  this.metrics.registerHistogram(
    'db_query_duration_seconds',
    'Database query duration',
    ['operation', 'table'],
    [0.001, 0.01, 0.1, 0.5, 1],
  );
}

// Usage
const stopTimer = this.metrics.startTimer('db_query_duration_seconds', {
  operation: 'SELECT',
  table: 'users',
});

const users = await this.userRepo.find();
stopTimer();
```

## Real-World Examples

### E-commerce Metrics

<<< @/apps/demo/src/plugins/metrics/recipes/ecommerce-metrics.usage.ts{typescript}

### API Metrics

<<< @/apps/demo/src/plugins/metrics/recipes/api-metrics.usage.ts{typescript}

### Background Job Metrics

<<< @/apps/demo/src/plugins/metrics/recipes/job-metrics.usage.ts{typescript}

## Middleware Integration

<<< @/apps/demo/src/plugins/metrics/service-middleware.usage.ts{typescript}

## Best Practices

**1. Use descriptive names:**

```typescript
// ✅ Good
'orders_created_total'
'payment_duration_seconds'
'inventory_level'

// ❌ Bad
'count'
'time'
'value'
```

**2. Include units in name:**

```typescript
// ✅ Good
'memory_bytes'
'duration_seconds'
'temperature_celsius'

// ❌ Bad
'memory'  // What unit?
'time'    // Seconds? Milliseconds?
```

**3. Use low-cardinality labels:**

```typescript
// ✅ Good - Limited values
{ status: 'success' }  // success, error
{ method: 'GET' }      // GET, POST, etc.

// ❌ Bad - High cardinality
{ user_id: '12345' }   // Millions of users!
{ timestamp: '...' }   // Infinite values!
```

**4. Choose correct metric type:**

| Use Case | Type |
|----------|------|
| Count events | Counter |
| Current value | Gauge |
| Latency/duration | Histogram |
| Size distribution | Histogram |

## Next Steps

- [Grafana](./grafana) — Visualize custom metrics
- [Alerting](./alerting) — Alert on custom metrics
- [Troubleshooting](./troubleshooting) — Debug metrics
