---
title: Troubleshooting
description: Debug common tracing issues
---

# Troubleshooting

Debug common issues with distributed tracing.

## Traces Not Appearing

### Problem: No traces in Jaeger/Tempo

**Symptoms:**
- Empty search results
- Service not listed
- No traces collected

**Solutions:**

**1. Check if tracing is enabled:**

```typescript
// Verify plugin is registered
new TracingPlugin({
  enabled: true,  // Make sure this is true
})
```

**2. Check exporter endpoint:**

```bash
# Test OTLP endpoint
curl -X POST http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d '{}'

# Should return 200 OK or 400 Bad Request (not connection error)
```

**3. Check application logs:**

```bash
# Look for tracing initialization
grep -i "tracing" app.log

# Should see: "TracingPlugin initialized"
```

**4. Verify sampling is not 0%:**

```typescript
{
  sampling: {
    strategy: 'always',  // Force 100% for debugging
  }
}
```

**5. Check Docker networking:**

```bash
# From app container, can you reach Jaeger?
docker exec app curl http://jaeger:4318/v1/traces

# If fails, check docker-compose.yml networking
```

### Problem: Some spans missing

**Causes:**

**1. Sampling enabled:**

```typescript
// Only collecting 1%
{
  sampling: { strategy: 'ratio', ratio: 0.01 }
}

// Fix: Increase ratio temporarily
{
  sampling: { strategy: 'always' }
}
```

**2. Span not ended:**

```typescript
// ❌ Wrong - Span leaked!
const span = tracer.startSpan('operation');
await doWork();
// Missing: span.end();

// ✅ Correct
const span = tracer.startSpan('operation');
try {
  await doWork();
} finally {
  span.end();  // Always called
}
```

**3. Context not propagated:**

```typescript
// ❌ Wrong - Creates new trace
async function helper() {
  const span = tracer.startSpan('helper');  // New root span!
  // ...
}

// ✅ Correct - Inherits context via withSpan
async function helper() {
  return this.tracing.withSpan('helper', async () => {
    // Automatically linked to parent
  });
}
```

## Connection Issues

### Problem: OTLP connection timeout

**Error:**

```
Error: connect ETIMEDOUT
  at OTLPTraceExporter.export
```

**Solutions:**

**1. Check endpoint:**

```bash
# Test connectivity
curl http://collector:4318/v1/traces

# Test from app container
docker exec app curl http://collector:4318/v1/traces
```

**2. Check firewall:**

```bash
# Check if port is open
telnet collector 4318
```

### Problem: Authentication failed

**Error:**

```
Error: 401 Unauthorized
```

**Solution:**

```typescript
{
  exporter: {
    type: 'otlp',
    endpoint: 'https://api.example.com/v1/traces',
    headers: {
      'authorization': `Bearer ${process.env.TRACING_TOKEN}`,
      'x-api-key': process.env.API_KEY,
    },
  }
}
```

## Performance Issues

### Problem: High memory usage

**Symptoms:**
- Application OOM
- Slow performance
- Memory leaks

**Causes:**

**1. Spans not being ended:**

```typescript
// Find leaked spans
console.log(process.memoryUsage());
// { heapUsed: 500MB, ... }  ← Growing over time!

// Fix: Always end spans
try {
  await operation();
} finally {
  span.end();
}
```

**2. Too many attributes:**

```typescript
// ❌ Wrong - Large attribute
span.setAttribute('request.body', JSON.stringify(largeObject));

// ✅ Correct - Limit size
span.setAttribute('request.size', largeObject.length);
```

**3. Too many events:**

```typescript
// ❌ Wrong - Event in loop
for (const item of items) {
  span.addEvent('item.processed', { id: item.id });  // 10,000 events!
}

// ✅ Correct - Aggregate
span.setAttribute('items.processed', items.length);
```

**Solutions:**

### Problem: Slow application performance

**Symptoms:**
- Increased latency
- High CPU usage

**Solutions:**

**1. Use BatchSpanProcessor:**

```typescript
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

// Batches spans for efficiency
const processor = new BatchSpanProcessor(exporter, {
  maxQueueSize: 2048,
  maxExportBatchSize: 512,
  scheduledDelayMillis: 5000,
});
```

**2. Reduce sampling:**

```typescript
{
  sampling: {
    strategy: 'ratio',
    ratio: 0.01,  // Only 1%
  }
}
```

**3. Disable verbose tracing:**

```typescript
{
  traceRedisCommands: false,  // Don't trace every Redis command
  pluginTracing: false,       // Don't trace plugin operations
}
```

## Context Propagation Issues

### Problem: Broken trace chain

**Symptoms:**
- Multiple separate traces instead of one
- Parent-child relationship missing

```
❌ Wrong:
Trace 1: HTTP GET /api/users/123
Trace 2: cache.get user:123  ← Should be child of Trace 1!
```

**Causes:**

**1. Context not propagated:**

```typescript
// ❌ Wrong - Starts new trace
async fetchUser(id: string) {
  const span = this.tracer.startSpan('user.fetch');  // New root!
  // ...
}

// ✅ Correct - Inherits context
async fetchUser(id: string) {
  return this.tracing.withSpan('user.fetch', async () => {
    // Automatically linked to active span
  });
}
```

**2. Async context lost:**

```typescript
// ❌ Wrong - Context lost in setTimeout
setTimeout(() => {
  const span = this.tracer.startSpan('delayed');  // New root!
}, 1000);

// ✅ Correct - Preserve context
import { context } from '@opentelemetry/api';

const ctx = context.active();
setTimeout(() => {
  context.with(ctx, () => {
    const span = this.tracer.startSpan('delayed');
    // Correctly linked!
  });
}, 1000);
```

**3. Missing HTTP propagation:**

```typescript
// ❌ Wrong - Trace context not sent
await axios.get('http://service-b/api/data');

// ✅ Correct - Auto-instrumentation handles it
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';

instrumentations: [new HttpInstrumentation()];
```

### Problem: Trace ID mismatch across services

**Symptoms:**
- Different trace IDs in Service A and Service B
- Can't find distributed trace

**Solutions:**

**1. Use same propagator:**

```typescript
// All services must use same propagator
import { W3CTraceContextPropagator } from '@opentelemetry/core';

const sdk = new NodeSDK({
  textMapPropagator: new W3CTraceContextPropagator(),
});
```

**2. Check HTTP headers:**

```bash
# Verify traceparent header is sent
curl -v http://service-a/api/data

# Should see:
# traceparent: 00-abc123...-def456...-01
```

## Exporter Issues

### Problem: Spans not exported

**Symptoms:**
- Spans created but not in backend
- No errors in logs

**Causes:**

**1. Spans in queue:**

```typescript
// Spans waiting in batch queue
// Wait for export or reduce delay

// Reduce batch delay via OTel SDK environment variable:
// OTEL_BSP_SCHEDULE_DELAY=1000
```

**2. Export failed silently:**

```typescript
// Enable debug logging
process.env.OTEL_LOG_LEVEL = 'debug';
```

**3. Graceful shutdown not called:**

```typescript
// App exits before spans exported
// Add shutdown handler

process.on('SIGTERM', async () => {
  await sdk.shutdown();
  process.exit(0);
});
```

### Problem: Too many export failures

**Error:**

```
Error: Failed to export spans
  at OTLPTraceExporter
```

**Solutions:**

**1. Check backend health:**

```bash
# Is Jaeger running?
docker ps | grep jaeger

# Is it healthy?
curl http://jaeger:14269/health
```

**2. Check network:**

```bash
# Can app reach Jaeger?
docker exec app ping jaeger
docker exec app curl http://jaeger:4318/v1/traces
```

**3. Check rate limits:**

```
Some backends rate-limit ingestion
→ Reduce sampling or use buffering
```

## Debugging Checklist

- [ ] TracingPlugin is enabled
- [ ] Exporter endpoint is reachable
- [ ] Sampling is configured (not 0%)
- [ ] Application is making requests
- [ ] Spans are being created (check logs)
- [ ] Spans are being ended
- [ ] Context is propagating correctly
- [ ] Backend is receiving spans
- [ ] Time range includes data

## Debug Commands

```bash
# Check if tracing is initialized
grep -i "tracing" app.log

# Test OTLP endpoint
curl -X POST http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d '{}'

# Check Jaeger health
curl http://localhost:14269/health

# Check services in Jaeger
curl http://localhost:16686/api/services

# Check traces for service
curl 'http://localhost:16686/api/traces?service=user-service&limit=10'

# Enable debug logging
export OTEL_LOG_LEVEL=debug
export DEBUG=*

# Check memory usage
docker stats app

# Check for leaked spans
node --inspect app.js
# Then use Chrome DevTools → Memory → Take Heap Snapshot
```

## Enable Debug Logging

### OpenTelemetry SDK

```typescript
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
```

**Output:**

```
[OTEL] Creating span: user.get
[OTEL] Adding attribute: user.id = "123"
[OTEL] Ending span: user.get (duration: 1.23ms)
[OTEL] Exporting 1 spans
[OTLP] Sending spans to http://jaeger:4318/v1/traces
[OTLP] Export successful
```

### TracingPlugin

To debug the tracing plugin, use the OpenTelemetry diagnostic logger above. The plugin uses the standard OTel SDK internally.

## Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `ETIMEDOUT` | Can't reach exporter | Check endpoint, network |
| `401 Unauthorized` | Missing auth | Add headers with API key |
| `413 Payload Too Large` | Span too big | Reduce attributes, events |
| `Context lost` | Async boundary | Preserve context manually |
| `Span not ended` | Missing end() call | Use try/finally or withSpan() |
| `No traces found` | Sampling = 0% | Increase sampling ratio |

## Validation Script

```typescript
import { trace } from '@opentelemetry/api';
import axios from 'axios';

async function validateTracing() {
  console.log('🔍 Validating tracing setup...\n');

  // 1. Check tracer
  const tracer = trace.getTracer('validation');
  if (!tracer) {
    console.error('❌ Tracer not initialized');
    return;
  }
  console.log('✅ Tracer initialized');

  // 2. Create test span
  const span = tracer.startSpan('test.span');
  span.setAttribute('test', true);
  span.end();
  console.log('✅ Span created and ended');

  // 3. Check exporter
  try {
    await axios.post('http://localhost:4318/v1/traces', {});
    console.log('✅ Exporter endpoint reachable');
  } catch (error) {
    console.error('❌ Exporter endpoint unreachable:', error.message);
    return;
  }

  // 4. Check backend
  try {
    const { data } = await axios.get('http://localhost:16686/api/services');
    console.log('✅ Jaeger backend reachable');
    console.log('   Services:', data.data);
  } catch (error) {
    console.error('❌ Jaeger backend unreachable:', error.message);
  }

  console.log('\n✅ Tracing validation complete');
}

validateTracing();
```

## Getting Help

**Check documentation:**
- [OpenTelemetry Docs](https://opentelemetry.io/docs/)
- [Jaeger Docs](https://www.jaegertracing.io/docs/)
- [Grafana Tempo Docs](https://grafana.com/docs/tempo/)

**Community support:**
- [OpenTelemetry Slack](https://cloud-native.slack.com/)
- [Jaeger GitHub](https://github.com/jaegertracing/jaeger)
- [Stack Overflow](https://stackoverflow.com/questions/tagged/opentelemetry)

## Next Steps

- [Testing](./testing) — Test traced services
- [Recipes](./recipes) — Real-world patterns
- [Configuration](./configuration) — Review configuration
- [Spans](./spans) — Check span creation
- [Visualization](./visualization) — Analyze traces
