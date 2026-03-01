---
title: Troubleshooting
description: Common issues and solutions
---

# Troubleshooting

Debug common streaming issues.

## Messages Not Processing

### Problem: Consumer not receiving messages

**Symptoms:**
- Messages published to stream
- Consumer running but not processing
- Stream length growing

**Causes & Solutions:**

**1. Consumer group doesn't exist:**

```bash
# Check if group exists
redis-cli XINFO GROUPS orders

# Create group if missing
redis-cli XGROUP CREATE orders processors 0 MKSTREAM
```

**2. Consumer reading from wrong position:**

```typescript
// ❌ Wrong - starts from end, misses existing messages
await consumer.createGroup('orders', 'processors', '$');

// ✅ Correct - starts from beginning
await consumer.createGroup('orders', 'processors', '0');
```

**3. Messages stuck in pending:**

```bash
# Check pending count
redis-cli XPENDING orders processors
# Output: (integer) 150  ← Messages pending

# Claim idle messages (via IStreamConsumer)
# const claimed = await consumer.claimIdle('orders', 'processors', 'worker-1', 30000);
```

**4. Wrong stream name:**

```typescript
// Publisher
await producer.publish('orders', data);  // 'orders'

// Consumer
@StreamConsumer({ stream: 'order', group: 'processors' })  // ❌ 'order' (typo!)
```

## High Consumer Lag

### Problem: Messages piling up faster than processing

**Symptoms:**
- Stream length increasing
- Consumer lag > 10,000
- Slow message processing

**Solutions:**

**1. Increase concurrency:**

```typescript
@StreamConsumer({
  stream: 'orders',
  group: 'processors',
  concurrency: 20,  // Increase from 1
  batchSize: 50,    // Larger batches
})
```

**2. Add more consumer instances:**

```bash
# Scale horizontally
docker-compose up --scale worker=5
```

**3. Optimize handler code:**

```typescript
// ❌ Slow - sequential processing
for (const item of items) {
  await this.processItem(item);
}

// ✅ Fast - parallel processing
await Promise.all(items.map(item => this.processItem(item)));
```

**4. Increase batch size and concurrency:**

```typescript
@StreamConsumer({
  stream: 'analytics',
  group: 'processors',
  batchSize: 100,    // Fetch 100 at a time from Redis
  concurrency: 20,   // Process 20 in parallel
})
async handle(message: IStreamMessage<Event>) {
  await this.db.insert(message.data);
  await message.ack();
}
```

## Memory Issues

### Problem: High memory usage or OOM errors

**Symptoms:**
- Memory usage growing
- Process crashes with OOM
- Slow performance

**Causes & Solutions:**

**1. Too many concurrent messages:**

```typescript
// ❌ Too high concurrency
concurrency: 100

// ✅ Reasonable concurrency
concurrency: 10
```

**2. Large message batch size:**

```typescript
// ❌ Too large batches
batchSize: 1000

// ✅ Reasonable batches
batchSize: 50
```

**3. Memory leaks in handler:**

```typescript
// ❌ Potential leak - data not cleaned up
const cache = new Map();

async handle(message) {
  cache.set(message.id, message.data);  // Never cleared!
  await this.process(message.data);
}

// ✅ Clean up after processing
async handle(message) {
  try {
    await this.process(message.data);
  } finally {
    this.cleanup(message.id);
  }
}
```

**4. Stream too large:**

```typescript
// Enable trimming
await producer.publish('orders', data, {
  maxLen: 100000,  // Keep only 100K messages
});
```

## Duplicate Processing

### Problem: Same message processed multiple times

**Symptoms:**
- Duplicate database records
- Multiple notifications sent
- Idempotency violated

**Causes & Solutions:**

**1. Handler not idempotent:**

```typescript
// ❌ Not idempotent - creates duplicate records
async handle(message: IStreamMessage<Order>) {
  await this.orderRepo.create(message.data);
  await message.ack();
}

// ✅ Idempotent - checks if already processed
async handle(message: IStreamMessage<Order>) {
  const exists = await this.orderRepo.findOne(message.data.orderId);

  if (exists) {
    await message.ack();  // Already processed
    return;
  }

  await this.orderRepo.create(message.data);
  await message.ack();
}
```

**2. Message not acknowledged:**

```typescript
// ❌ No ACK - message will be redelivered
async handle(message: IStreamMessage<Order>) {
  await this.process(message.data);
  // Missing: await message.ack();
}

// ✅ Always ACK
async handle(message: IStreamMessage<Order>) {
  await this.process(message.data);
  await message.ack();
}
```

**3. Multiple consumer groups:**

```typescript
// This is expected! Different groups each get all messages
@StreamConsumer({ stream: 'orders', group: 'processors' })    // Group 1
@StreamConsumer({ stream: 'orders', group: 'analytics' })     // Group 2

// Both will process the same message (fan-out pattern)
```

## Dead Consumers

### Problem: Consumer crashed, messages stuck

**Symptoms:**
- High pending messages
- Messages not processing
- Consumer idle for long time

**Solutions:**

**1. Configure idle claim timeout (module-level):**

```typescript
new StreamsPlugin({
  consumer: {
    claimIdleTimeout: 30000,  // Claim messages idle > 30s
  },
})
```

**2. Manual claim:**

```bash
# Find idle messages
redis-cli XPENDING orders processors - + 100

# Claim them
redis-cli XCLAIM orders processors new-consumer 30000 message-id-1 message-id-2
```

**3. Delete dead consumer:**

```bash
# Check consumers
redis-cli XINFO CONSUMERS orders processors

# Delete dead consumer
redis-cli XGROUP DELCONSUMER orders processors dead-worker
```

## High DLQ Size

### Problem: Many messages in DLQ

**Symptoms:**
- DLQ size > 100
- Frequent max retries
- Error rate high

**Causes & Solutions:**

**1. Identify error patterns:**

```typescript
// Check DLQ messages using DeadLetterService
const dlqMessages = await this.dlq.getMessages('orders');

// Group by error type
const errorCounts = {};
dlqMessages.forEach(msg => {
  errorCounts[msg.error] = (errorCounts[msg.error] || 0) + 1;
});

console.log(errorCounts);
// { "Payment gateway timeout": 50, "Invalid address": 30 }
```

**2. Fix root cause:**

```typescript
// If many timeouts - increase timeout
if (error.message.includes('timeout')) {
  await Promise.race([
    this.process(data),
    this.timeout(60000),  // Increase from 30s to 60s
  ]);
}
```

**3. Requeue after fix:**

```typescript
// Fix the issue first, then requeue individual messages
await this.dlq.requeue(messageId, 'orders');
```

**4. Purge if needed:**

```typescript
// If messages are invalid/old
await this.dlq.purge('orders');
```

## Stream Too Large

### Problem: Stream growing unbounded

**Symptoms:**
- Stream length > 1M
- High Redis memory
- Slow XREADGROUP

**Solutions:**

**1. Enable auto-trimming:**

```typescript
// Trim on every publish
await producer.publish('orders', data, {
  maxLen: 100000,  // Keep only 100K messages
});
```

**2. Manual trim:**

```bash
# Trim stream to 100K messages
redis-cli XTRIM orders MAXLEN ~ 100000
```

**3. Use event sourcing with snapshots:**

```typescript
// Store snapshot every 1000 events
if (eventCount % 1000 === 0) {
  await this.snapshotRepo.create(aggregate);
  // Older events can be archived/trimmed
}
```

## Connection Issues

### Problem: Redis connection failures

**Symptoms:**
- Error: "Connection refused"
- Intermittent failures
- Timeout errors

**Solutions:**

**1. Check Redis is running:**

```bash
redis-cli ping
# Should return: PONG
```

**2. Verify connection config:**

```typescript
RedisModule.forRoot({
  clients: {
    host: 'localhost',  // Correct host?
    port: 6379,         // Correct port?
  },
})
```

**3. Add retry logic:**

```typescript
RedisModule.forRoot({
  clients: {
    host: 'localhost',
    port: 6379,
    retryStrategy: (times) => {
      if (times > 10) {
        return null;  // Stop retrying
      }
      return Math.min(times * 100, 3000);  // Exponential backoff
    },
  },
})
```

## XREADGROUP Timeout Errors

### Problem: Command "XREADGROUP" failed: Command timed out

**Symptoms:**
- Error: `CommandError: Command "XREADGROUP" failed: Command timed out`
- Error loop in consumer logs
- Messages not being consumed

**Cause:**

`XREADGROUP BLOCK 5000` is a blocking Redis command that holds the connection for up to 5 seconds. If your `commandTimeout` is <= `blockTimeout`, the command times out before it can return results.

**Solution 1: Dedicated client (recommended)**

Use a separate Redis connection for Streams with a higher `commandTimeout`:

<<< @/apps/demo/src/plugins/streams/dedicated-client.setup.ts{typescript}

**Solution 2: Adjust timeouts on shared connection**

If you cannot use a dedicated client, ensure `commandTimeout > blockTimeout`:

```typescript
RedisModule.forRoot({
  clients: {
    host: 'localhost',
    port: 6379,
    commandTimeout: 10000,  // Must be > blockTimeout
  },
  plugins: [
    new StreamsPlugin({
      consumer: {
        blockTimeout: 5000,  // Must be < commandTimeout
      },
    }),
  ],
})
```

::: warning
Solution 2 increases timeout for ALL Redis operations, not just Streams. This can mask real timeout issues in cache/locks/rate-limit operations. Solution 1 (dedicated client) is strongly recommended for production.
:::

## Performance Issues

### Problem: Slow message processing

**Symptoms:**
- Low throughput (< 100 msg/s)
- High processing duration
- CPU or I/O bottlenecks

**Solutions:**

**1. Profile handler code:**

```typescript
async handle(message: IStreamMessage<Order>) {
  const start = Date.now();

  await this.step1();  // Measure each step
  console.log('Step 1:', Date.now() - start);

  await this.step2();
  console.log('Step 2:', Date.now() - start);
}
```

**2. Optimize I/O:**

```typescript
// ❌ Sequential I/O
await this.db.find(id1);
await this.db.find(id2);
await this.db.find(id3);

// ✅ Parallel I/O
await Promise.all([
  this.db.find(id1),
  this.db.find(id2),
  this.db.find(id3),
]);
```

**3. Use caching:**

```typescript
// Cache frequently accessed data
const cachedUser = await this.cache.get(`user:${userId}`);

if (cachedUser) {
  return cachedUser;
}

const user = await this.db.findUser(userId);
await this.cache.set(`user:${userId}`, user, { ttl: 3600 });
return user;
```

**4. Increase resources:**

- Add more CPU cores
- Increase Redis memory
- Scale horizontally

## Debugging Checklist

- [ ] Redis is running and accessible
- [ ] Consumer group created
- [ ] Stream name matches between producer/consumer
- [ ] Messages being published (check stream length)
- [ ] Handler function executing (add logs)
- [ ] Messages being acknowledged
- [ ] No errors in logs
- [ ] Pending count normal (< 1000)
- [ ] DLQ size normal (< 100)
- [ ] Consumer lag acceptable

## Debugging Commands

```bash
# Stream info
redis-cli XINFO STREAM orders

# Group info
redis-cli XINFO GROUPS orders

# Consumer info
redis-cli XINFO CONSUMERS orders processors

# Pending messages
redis-cli XPENDING orders processors

# Read messages
redis-cli XRANGE orders - + COUNT 10

# Delete stream (careful!)
redis-cli DEL orders
```

## Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `NOGROUP No such key or consumer group` | Group doesn't exist | Create group with XGROUP CREATE |
| `BUSYGROUP Consumer Group name already exists` | Group already exists | Use existing group or delete old one |
| `OOM command not allowed when used memory > 'maxmemory'` | Redis out of memory | Increase maxmemory or trim streams |
| `Connection refused` | Redis not running | Start Redis server |
| `Timeout exceeded` | Processing too slow | Increase timeout or optimize handler |

## Next Steps

- [Monitoring](./monitoring) — Track metrics to prevent issues
- [Overview](./index) — Back to overview
