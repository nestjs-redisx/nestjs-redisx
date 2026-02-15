---
title: Deployment
description: Redis deployment topologies - Single, Sentinel, Cluster
---

# Deployment

Choose the right Redis topology for your availability and scalability needs.

## Topology Comparison

```mermaid
graph TB
    subgraph "Single Node"
        S1[Redis]
    end
    
    subgraph "Sentinel"
        SM[Master]
        SR1[Replica]
        SR2[Replica]
        SE1[Sentinel]
        SE2[Sentinel]
        SE3[Sentinel]
    end
    
    subgraph "Cluster"
        C1[Shard 1<br>Master + Replica]
        C2[Shard 2<br>Master + Replica]
        C3[Shard 3<br>Master + Replica]
    end
```

| Topology | HA | Scalability | Complexity | Use Case |
|----------|-----|-------------|------------|----------|
| Single | No | Vertical | Low | Dev, small apps |
| Sentinel | Yes | Vertical | Medium | Production HA |
| Cluster | Yes | Horizontal | High | Large scale |

## Single Node

**Best for:** Development, small applications, non-critical workloads

```typescript
RedisModule.forRoot({
  clients: {
    host: 'redis',
    port: 6379,
  },
})
```

**Limitations:**
- No automatic failover
- Memory limited to single machine
- Single point of failure

## Sentinel (Recommended for HA)

**Best for:** Production with high availability needs

```mermaid
graph TB
    App[Application] --> SE{Sentinel}
    SE --> M[Master]
    SE --> R1[Replica 1]
    SE --> R2[Replica 2]
    
    M --> R1
    M --> R2
```

```typescript
RedisModule.forRoot({
  clients: {
    sentinels: [
      { host: 'sentinel-1', port: 26379 },
      { host: 'sentinel-2', port: 26379 },
      { host: 'sentinel-3', port: 26379 },
    ],
    name: 'mymaster',
    password: process.env.REDIS_PASSWORD,
  },
})
```

**Failover behavior:**
1. Sentinel detects master failure
2. Sentinels elect new master
3. Client redirected to new master
4. ~30 seconds failover time

## Cluster

**Best for:** Large-scale applications needing horizontal scaling

```typescript
// ioredis cluster mode
import { Cluster } from 'ioredis';

const cluster = new Cluster([
  { host: 'node-1', port: 6379 },
  { host: 'node-2', port: 6379 },
  { host: 'node-3', port: 6379 },
], {
  redisOptions: {
    password: process.env.REDIS_PASSWORD,
  },
  scaleReads: 'slave',
});
```

**Key hashing:**
- Keys distributed across 16384 slots
- Use `{hash_tag}` to co-locate related keys
- Some commands limited to single slot

```typescript
// These keys will be on same shard
'user:{123}:profile'
'user:{123}:settings'
'user:{123}:orders'
```

## Decision Matrix

| Factor | Single | Sentinel | Cluster |
|--------|--------|----------|---------|
| Data size | <10GB | <100GB | >100GB |
| Availability needs | Low | High | High |
| Operations team | Small | Medium | Large |
| Budget | Low | Medium | Higher |
| Failover time | Manual | ~30s | ~15s |

## Cloud Managed Options

| Provider | Service | Topology Support |
|----------|---------|------------------|
| AWS | ElastiCache | Single, Cluster |
| GCP | Memorystore | Single, Cluster |
| Azure | Azure Cache | Single, Cluster |
| Redis Labs | Redis Cloud | All |

**Benefits of managed:**
- Automatic patching
- Backup/restore
- Monitoring included
- Simplified operations

## High Availability Architecture

```mermaid
graph TB
    subgraph "Region A"
        App1[App Server 1]
        App2[App Server 2]
        LB[Load Balancer]
    end
    
    subgraph "Redis Sentinel"
        M[Master]
        R1[Replica]
        R2[Replica]
        S1[Sentinel 1]
        S2[Sentinel 2]
        S3[Sentinel 3]
    end
    
    LB --> App1
    LB --> App2
    App1 --> S1
    App2 --> S1
    S1 --> M
    M --> R1
    M --> R2
```

## Persistence Configuration

| Mode | Durability | Performance |
|------|------------|-------------|
| None | Lowest | Highest |
| RDB | Medium | High |
| AOF | High | Medium |
| RDB + AOF | Highest | Lower |

**For caching:** RDB or none
**For queues/locks:** AOF recommended

```
# redis.conf
appendonly yes
appendfsync everysec
```

## Next Steps

- [Tuning](./tuning) — Performance optimization
- [Connection Management](./connection-management) — Connection config
