---
title: Security
description: TLS, ACL, data classification, and security best practices
---

# Security

Secure your Redis deployment and data.

## TLS/SSL Configuration

### Basic TLS

```typescript
RedisModule.forRoot({
  clients: {
    host: 'redis.example.com',
    port: 6379,
    tls: {},  // Use default TLS settings
  },
})
```

### With Certificate Verification

```typescript
import * as fs from 'fs';

RedisModule.forRoot({
  clients: {
    host: 'redis.example.com',
    port: 6379,
    tls: {
      ca: fs.readFileSync('/path/to/ca.crt'),
      cert: fs.readFileSync('/path/to/client.crt'),
      key: fs.readFileSync('/path/to/client.key'),
      rejectUnauthorized: true,
    },
  },
})
```

### Self-Signed Certificates (Dev Only)

```typescript
// Development only - do not use in production
{
  tls: {
    rejectUnauthorized: false,
  },
}
```

## Redis ACL (Redis 6+)

### User Configuration

```
# redis.conf or ACL file
user app-user on >secure-password ~cache:* ~lock:* +@read +@write -@admin
user admin-user on >admin-password ~* +@all
```

### Application Connection

```typescript
RedisModule.forRoot({
  clients: {
    host: 'redis.example.com',
    port: 6379,
    username: 'app-user',
    password: process.env.REDIS_PASSWORD,
  },
})
```

### Recommended Permissions

| Role | Keys | Commands |
|------|------|----------|
| Application | `cache:*`, `lock:*`, `ratelimit:*` | read, write |
| Monitoring | `*` | read only |
| Admin | `*` | all |

## Secrets Management

### Environment Variables

```typescript
// Use environment variables
RedisModule.forRoot({
  clients: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD,
  },
})
```

### Secrets Manager

```typescript
// AWS Secrets Manager example
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

async function getRedisConfig() {
  const sm = new SecretsManager({});
  const secret = await sm.getSecretValue({ SecretId: 'redis-credentials' });
  const { host, port, password } = JSON.parse(secret.SecretString);
  return { host, port, password };
}

// Use in module
RedisModule.forRootAsync({
  useFactory: async () => ({
    clients: await getRedisConfig(),
  }),
})
```

## Data Classification

### What Can Be Cached

| Data Type | Cache? | Notes |
|-----------|--------|-------|
| Public content | Yes | Product info, blog posts |
| User preferences | Yes | UI settings, language |
| Session references | Yes | Session ID → user ID mapping |
| Aggregated metrics | Yes | Non-sensitive statistics |

### What Should NOT Be Cached

| Data Type | Cache? | Reason |
|-----------|--------|--------|
| Passwords | Never | Security risk |
| API keys/tokens | Never | Credential exposure |
| Credit card numbers | Never | PCI compliance |
| Social Security Numbers | Never | PII regulations |
| Medical records | Never | HIPAA compliance |
| Full authentication tokens | Never | Session hijacking risk |

### Borderline Cases

| Data Type | Recommendation | Conditions |
|-----------|----------------|------------|
| Email addresses | Maybe | If encrypted or hashed |
| Phone numbers | Maybe | If encrypted |
| Names | Maybe | Consider privacy laws |
| Addresses | Maybe | If needed for functionality |

## PII Handling

### Hash Sensitive Keys

```typescript
import { createHash } from 'crypto';

function hashPii(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

// Hash before calling cached method — raw PII never in key
async getUserByEmail(email: string) {
  return this.findByEmailHash(hashPii(email));
}

@Cached({ key: 'user:email:{0}' })
private async findByEmailHash(emailHash: string) {
  // DB query...
}
```

### Encrypt Sensitive Values

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

class SecureCache {
  private key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');

  encrypt(data: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  decrypt(data: string): string {
    const buf = Buffer.from(data, 'base64');
    const iv = buf.subarray(0, 16);
    const tag = buf.subarray(16, 32);
    const encrypted = buf.subarray(32);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }
}
```

## Key Injection Prevention

### Validate Key Components

```typescript
function validateKeyComponent(value: string): string {
  // Reject dangerous characters
  if (/[:\s\n\r\0]/.test(value)) {
    throw new Error('Invalid characters in cache key');
  }
  // Limit length
  if (value.length > 100) {
    throw new Error('Key component too long');
  }
  return value;
}

// Usage
@Cached({
  key: (args) => `user:${validateKeyComponent(args.userId)}`,
})
```

### Use Allowlists

```typescript
const VALID_ENTITY_TYPES = ['user', 'order', 'product'];

function buildKey(entity: string, id: string): string {
  if (!VALID_ENTITY_TYPES.includes(entity)) {
    throw new Error('Invalid entity type');
  }
  return `${entity}:${id}`;
}
```

## Compliance Considerations

### GDPR

- Implement data deletion (cache eviction)
- Respect data minimization
- Document what's cached

### PCI-DSS

- Never cache card data
- Use encryption in transit (TLS)
- Implement access controls (ACL)

### HIPAA

- Encrypt PHI at rest and in transit
- Implement audit logging
- Strict access controls

## Security Checklist

::: tip Pre-Production Review
Verify these items before deploying to production:
:::

| Item | Status |
|------|--------|
| TLS enabled for all connections | |
| Strong passwords configured | |
| ACL configured with least privilege | |
| Secrets in environment/secrets manager | |
| No PII in cache keys | |
| Sensitive values encrypted | |
| Key components validated | |
| Network access restricted | |
| Monitoring for anomalies | |

## Next Steps

- [Connection Management](./connection-management) — Secure connection setup
- [Key Naming](./key-naming) — Safe key patterns
