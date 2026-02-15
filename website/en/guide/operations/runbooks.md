---
title: Runbooks
description: Incident response procedures for common RedisX issues
---

# Runbooks

Step-by-step procedures for responding to common incidents.

## Runbook: Redis Connection Lost

**Alert:** `RedisConnectionLost`

### Symptoms
- Application errors mentioning Redis
- Cache miss rate 100%
- Lock operations failing

### Investigation

```bash
# 1. Check Redis status
redis-cli ping

# 2. Check network connectivity
nc -zv redis-host 6379

# 3. Check Redis logs
kubectl logs statefulset/redis

# 4. Check application logs
kubectl logs -l app=my-service --tail=100 | grep -i redis
```

### Resolution

| Cause | Action |
|-------|--------|
| Redis crashed | Restart Redis, check memory |
| Network issue | Check security groups, DNS |
| Auth failure | Verify credentials |
| Max connections | Increase maxclients or reduce pool |

### Recovery

1. Once Redis is back, verify connectivity
2. Application should auto-reconnect
3. Monitor cache hit rate returning to normal
4. Check for any DLQ messages during outage

---

## Runbook: High Cache Miss Rate

**Alert:** `CacheHitRateBelow80`

### Symptoms
- Cache hit rate < 80%
- Increased database load
- Higher latency

### Investigation

```bash
# Check cache key distribution
redis-cli --scan --pattern "cache:*" | wc -l

# Check memory usage
redis-cli INFO memory

# Check eviction rate
redis-cli INFO stats | grep evicted
```

### Resolution

| Cause | Action |
|-------|--------|
| TTL too short | Increase TTL |
| Cache evictions | Increase Redis memory |
| Cold start | Wait for cache to warm |
| Tag invalidation | Review invalidation patterns |

---

## Runbook: Lock Contention

**Alert:** `HighLockContention`

### Symptoms
- Lock timeout rate > 5%
- Increased request latency
- Timeouts in lock-protected operations

### Investigation

```bash
# Check active locks
redis-cli KEYS "lock:*"

# Check lock TTLs
redis-cli TTL "lock:payment:order-123"

# Check who holds lock
redis-cli GET "lock:payment:order-123"
```

### Resolution

| Cause | Action |
|-------|--------|
| Long operations | Reduce lock scope |
| Stuck lock | Wait for TTL or manual release |
| Too many workers | Reduce concurrency |
| Lock key too broad | Make keys more specific |

### Manual Lock Release (Emergency)

::: danger Last Resort Only
Manual lock release can cause data corruption if the lock holder is still running.
:::

```bash
redis-cli DEL "lock:stuck-key"
```

---

## Runbook: Stream Consumer Lag

**Alert:** `StreamConsumerLagHigh`

### Symptoms
- Consumer lag > 1000 messages
- Delayed job processing
- Growing stream length

### Investigation

```bash
# Check stream length
redis-cli XLEN jobs

# Check consumer group info
redis-cli XINFO GROUPS jobs

# Check pending messages
redis-cli XPENDING jobs workers
```

### Resolution

| Cause | Action |
|-------|--------|
| Not enough consumers | Scale up workers |
| Slow processing | Optimize handlers |
| Consumer crashed | Check for stuck pending |
| DLQ processing slow | Address DLQ issues |

### Scale Consumers

```bash
kubectl scale deployment job-workers --replicas=20
```

---

## Runbook: DLQ Growing

**Alert:** `DLQNotEmpty`

### Symptoms
- Messages in DLQ
- Job failures
- Missing functionality

### Investigation

```bash
# Check DLQ length
redis-cli XLEN jobs:dlq

# Read DLQ messages
redis-cli XRANGE jobs:dlq - + COUNT 10
```

### Resolution

1. **Analyze failures** — Check error messages in DLQ
2. **Fix root cause** — Code bug, external service down, etc.
3. **Replay messages** — Move from DLQ back to main stream
4. **Clear DLQ** — After messages processed

### Replay DLQ Messages

```bash
# Manual replay script
redis-cli XRANGE jobs:dlq - + COUNT 100 | while read msg; do
  # Re-publish to main stream
  redis-cli XADD jobs '*' $msg
done
```

---

## Runbook: Rate Limit Blocking Legitimate Traffic

**Alert:** `HighRateLimitRejections`

### Symptoms
- High 429 response rate
- Customer complaints
- Normal traffic being blocked

### Investigation

```bash
# Check rate limit keys
redis-cli KEYS "ratelimit:*" | head -20

# Check specific user/IP
redis-cli GET "ratelimit:ip:1.2.3.4"
```

### Resolution

| Cause | Action |
|-------|--------|
| Limit too low | Increase limit |
| Traffic spike | Temporary increase |
| Bot traffic | Block at WAF |
| Shared IP (NAT) | Use user ID instead of IP |

### Temporary Limit Increase

```typescript
// In emergency, deploy with increased limits
@RateLimit({ limit: 1000, window: 60 }) // Was 100
```

---

## Emergency Contacts

| Role | Contact |
|------|---------|
| On-call engineer | PagerDuty |
| Redis admin | #redis-support |
| Application team | #app-team |

## Post-Incident

After resolving:

1. Document timeline in incident ticket
2. Update runbook if new learnings
3. Schedule post-mortem if needed
4. Create follow-up tasks for prevention
