---
title: Key Extraction
description: Identify clients for rate limiting - IP, User, API Key, Custom
---

# Key Extraction

Determine WHO is being rate limited.

## Built-in Extractors

| Extractor | Extracted Key | Use Case |
|-----------|------------|----------|
| `ip` | `192.168.1.1` | Public APIs |
| `user` | `user:123` | Authenticated APIs |
| `apiKey` | `apikey:sk_xxx` | API platforms |
| Static string | `{string}` | Global limits |

::: tip Redis Key Format
The full Redis key is built by `RateLimitService` as `{keyPrefix}{algorithm}:{extractedKey}`. For example, with default settings, the key `user:123` becomes `rl:sliding-window:user:123` in Redis.
:::

## IP Address (Default)

Limits by client IP address.

```typescript
// Default behavior
@RateLimit({ points: 100 })

// Explicit
@RateLimit({ key: 'ip', points: 100 })
```

### Extracting Real IP

Behind proxies/load balancers:

```typescript
// Trust X-Forwarded-For header
app.set('trust proxy', true);

// Or configure custom extraction
new RateLimitPlugin({
  defaultKeyExtractor: (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    return req.headers['x-real-ip'] ||
           req.headers['x-forwarded-for']?.split(',')[0] ||
           req.ip;
  },
})
```

### When to Use

- Public endpoints without authentication
- Login/registration endpoints
- Default for unknown clients

### Limitations

- NAT: many users share IP
- VPN: users can change IP
- Proxies: may hide real IP

## User ID

Limits by authenticated user.

```typescript
@RateLimit({ key: 'user', points: 100 })
```

### How It Works

```typescript
// Expects request.user.id to be set
// Usually by authentication guard

@UseGuards(AuthGuard, RateLimitGuard)
@RateLimit({ key: 'user', points: 100 })
async getProtectedData() {}
```

### When to Use

- Authenticated endpoints
- Per-user quotas
- Fair usage across users

### Requirements

- Authentication guard must run BEFORE rate limit guard
- `request.user.id` must be populated

## API Key

Limits by API key.

```typescript
@RateLimit({ key: 'apiKey', points: 1000 })
```

### How It Works

```typescript
// Reads from X-API-Key header
// Request: GET /api/data
//          X-API-Key: sk_live_abc123

// Key becomes: rl:apikey:sk_live_abc123
```

### Custom Header

```typescript
new RateLimitPlugin({
  defaultKeyExtractor: (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    return req.headers['authorization']?.replace('Bearer ', '') || req.ip;
  },
})
```

### When to Use

- API platforms
- Third-party integrations
- Different limits per key tier

## Static Key

Global limit across all clients.

```typescript
@RateLimit({ key: 'global', points: 10000 })
```

### Use Cases

```typescript
// Global API limit
@RateLimit({ key: 'global:api', points: 100000, duration: 60 })

// Per-endpoint global limit
@RateLimit({ key: 'global:expensive', points: 100, duration: 60 })
async expensiveOperation() {}
```

### When to Use

- Protect expensive operations globally
- Server-wide capacity limits
- Combined with per-user limits

## Custom Key Functions

Full control over key generation.

```typescript
type KeyExtractor = (context: ExecutionContext) => string | Promise<string>;
```

### By Tenant

```typescript
@RateLimit({
  key: (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    return `tenant:${req.headers['x-tenant-id']}`;
  },
  points: 1000,
})
```

### By Route + User

```typescript
@RateLimit({
  key: (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    const route = req.route.path;
    const user = req.user?.id || req.ip;
    return `${route}:${user}`;
  },
  points: 50,
})
```

### By Organization

```typescript
@RateLimit({
  key: async (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    const orgId = await this.orgService.getOrgForUser(req.user.id);
    return `org:${orgId}`;
  },
  points: 5000,
})
```

### Composite Key

```typescript
@RateLimit({
  key: (ctx) => {
    const req = ctx.switchToHttp().getRequest();
    // Different limits for different user types
    const tier = req.user?.tier || 'free';
    return `${tier}:${req.user?.id || req.ip}`;
  },
})
```

## Combining Keys

### IP + User

```typescript
@Controller('api')
export class ApiController {
  @Get('data')
  @RateLimit({ key: 'ip', points: 1000, duration: 60 })    // 1000/min per IP
  @RateLimit({ key: 'user', points: 100, duration: 60 })   // 100/min per user
  getData() {}
}
```

### Global + Per-User

```typescript
@Controller('api')
@RateLimit({ key: 'global', points: 10000, duration: 60 })  // Global cap
export class ApiController {
  @Get('data')
  @RateLimit({ key: 'user', points: 100, duration: 60 })    // Per-user limit
  getData() {}
}
```

## Best Practices

### Do

```typescript
// Use specific keys
key: `user:${req.user.id}`

// Combine multiple layers
@RateLimit({ key: 'ip' })    // Prevent abuse
@RateLimit({ key: 'user' })  // Fair usage

// Handle missing identifiers
key: (ctx) => req.user?.id || `anon:${req.ip}`
```

### Don't

```typescript
// Use sensitive data in keys
key: `user:${req.user.email}`  // PII in Redis!

// Very long keys
key: `${JSON.stringify(req.body)}`  // Memory waste

// Forget fallback
key: (ctx) => req.user.id  // Fails if not authenticated
```

## Next Steps

- [Headers](./headers) — Response headers
- [Recipes](./recipes) — Common patterns
