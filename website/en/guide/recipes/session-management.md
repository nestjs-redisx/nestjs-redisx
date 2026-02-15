---
title: Session Management
description: Distributed sessions with sliding expiration
---

# Session Management

Redis-backed sessions for multi-instance deployments.

## Implementation

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { CACHE_SERVICE, ICacheService } from '@nestjs-redisx/cache';

@Injectable()
export class SessionService {
  private readonly SESSION_TTL = 3600;
  private readonly MAX_AGE = 86400;

  constructor(@Inject(CACHE_SERVICE) private readonly cache: ICacheService) {}

  async create(userId: string, data: Partial<SessionData>): Promise<string> {
    const sessionId = uuid();
    const session: SessionData = {
      userId,
      ...data,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };

    await this.cache.set(`session:${sessionId}`, session, { ttl: this.SESSION_TTL });
    return sessionId;
  }

  async get(sessionId: string): Promise<SessionData | null> {
    const session = await this.cache.get<SessionData>(`session:${sessionId}`);
    if (!session) return null;

    // Check absolute max age
    if (Date.now() - session.createdAt > this.MAX_AGE * 1000) {
      await this.destroy(sessionId);
      return null;
    }

    // Sliding expiration
    session.lastAccessedAt = Date.now();
    await this.cache.set(`session:${sessionId}`, session, { ttl: this.SESSION_TTL });
    return session;
  }

  async destroy(sessionId: string): Promise<void> {
    await this.cache.delete(`session:${sessionId}`);
  }

  async destroyAllForUser(userId: string): Promise<number> {
    const sessionIds = await this.cache.get<string[]>(`user:sessions:${userId}`) || [];
    for (const id of sessionIds) {
      await this.cache.delete(`session:${id}`);
    }
    await this.cache.delete(`user:sessions:${userId}`);
    return sessionIds.length;
  }
}
```

## Session Guard

```typescript
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessionService: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const sessionId = request.cookies?.session_id || request.headers['x-session-id'];

    if (!sessionId) throw new UnauthorizedException('No session');

    const session = await this.sessionService.get(sessionId);
    if (!session) throw new UnauthorizedException('Invalid session');

    request.session = session;
    return true;
  }
}
```

## What to Store

| Store | Don't Store |
|-------|-------------|
| User ID | Passwords |
| Roles | Full user object |
| Preferences | Large blobs |
| CSRF token | Credit cards |

## Next Steps

- [Security](../architecture/security) — Session security
- [Cache Reference](../../reference/cache/) — Full API
