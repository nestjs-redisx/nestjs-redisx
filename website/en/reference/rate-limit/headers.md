---
title: Response Headers
description: X-RateLimit headers and client-side handling
---

# Response Headers

Communicate rate limit status to clients.

## Standard Headers

```http
X-RateLimit-Limit: 100          # Maximum requests in window
X-RateLimit-Remaining: 75       # Requests left
X-RateLimit-Reset: 1706123456   # Unix timestamp when limit resets
```

On 429 (Too Many Requests):

```http
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1706123456
Retry-After: 45                 # Seconds to wait before retry
```

## Enable Headers

Headers are enabled by default:

```typescript
new RateLimitPlugin({
  includeHeaders: true,  // Default
})
```

## Disable Headers

```typescript
new RateLimitPlugin({
  includeHeaders: false,
})
```

::: info
`includeHeaders` is a module-level setting only. It cannot be overridden per-endpoint.
:::

## Custom Header Names

```typescript
new RateLimitPlugin({
  headers: {
    limit: 'X-RateLimit-Limit',
    remaining: 'X-RateLimit-Remaining',
    reset: 'X-RateLimit-Reset',
    retryAfter: 'Retry-After',
  },
})
```

### Custom Names Example

```typescript
new RateLimitPlugin({
  headers: {
    limit: 'X-API-Limit',
    remaining: 'X-API-Remaining',
    reset: 'X-API-Reset-Time',
    retryAfter: 'X-Retry-After-Seconds',
  },
})
```

## Header Values

### X-RateLimit-Limit

Maximum requests allowed in the time window.

```http
X-RateLimit-Limit: 100
```

### X-RateLimit-Remaining

Requests remaining before hitting the limit.

```http
X-RateLimit-Remaining: 75   # 75 requests left
X-RateLimit-Remaining: 0    # Limit reached
```

### X-RateLimit-Reset

Unix timestamp (seconds) when the rate limit resets.

```http
X-RateLimit-Reset: 1706123456
```

Convert to Date:

```typescript
const resetTime = new Date(resetHeader * 1000);
```

### Retry-After

Seconds to wait before making another request (only on 429).

```http
Retry-After: 45  # Wait 45 seconds
```

## Client-Side Handling

### JavaScript/TypeScript

```typescript
async function apiCall(): Promise<Response> {
  const response = await fetch('/api/data');

  const remaining = parseInt(response.headers.get('X-RateLimit-Remaining') || '0');
  const reset = parseInt(response.headers.get('X-RateLimit-Reset') || '0');

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
    throw new RateLimitError(`Retry in ${retryAfter}s`);
  }

  if (remaining < 10) {
    console.warn(`Approaching rate limit. ${remaining} requests left.`);
  }

  return response;
}
```

### Axios Interceptor

```typescript
import axios from 'axios';

axios.interceptors.response.use(
  (response) => {
    const remaining = response.headers['x-ratelimit-remaining'];
    if (remaining && parseInt(remaining) < 10) {
      console.warn(`Rate limit warning: ${remaining} requests left`);
    }
    return response;
  },
  async (error) => {
    if (error.response?.status === 429) {
      const retryAfter = parseInt(error.response.headers['retry-after'] || '60');
      await sleep(retryAfter * 1000);
      return axios.request(error.config);  // Retry
    }
    throw error;
  }
);
```

### Fetch with Retry

```typescript
async function fetchWithRetry(url: string, options?: RequestInit): Promise<Response> {
  const response = await fetch(url, options);

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
    console.log(`Rate limited. Retrying in ${retryAfter}s`);

    await sleep(retryAfter * 1000);
    return fetchWithRetry(url, options);
  }

  return response;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

## Proactive Rate Limiting

### Track Remaining Requests

```typescript
class RateLimitTracker {
  private remaining: number = Infinity;
  private reset: number = 0;

  updateFromHeaders(headers: Headers): void {
    const remaining = headers.get('X-RateLimit-Remaining');
    const reset = headers.get('X-RateLimit-Reset');

    if (remaining) this.remaining = parseInt(remaining);
    if (reset) this.reset = parseInt(reset);
  }

  shouldWait(): boolean {
    return this.remaining === 0 && Date.now() / 1000 < this.reset;
  }

  getWaitTime(): number {
    return Math.max(0, this.reset - Date.now() / 1000);
  }
}
```

### Pre-emptive Throttling

```typescript
async function smartApiCall(tracker: RateLimitTracker): Promise<Response> {
  // Wait if limit reached
  if (tracker.shouldWait()) {
    const waitTime = tracker.getWaitTime();
    console.log(`Waiting ${waitTime}s for rate limit reset`);
    await sleep(waitTime * 1000);
  }

  const response = await fetch('/api/data');
  tracker.updateFromHeaders(response.headers);

  return response;
}
```

## Display Rate Limit Info

### React Component

```tsx
import React, { useState, useEffect } from 'react';

function RateLimitIndicator() {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [limit, setLimit] = useState<number | null>(null);

  useEffect(() => {
    // Update on each API call
    const updateRateLimit = (headers: Headers) => {
      setRemaining(parseInt(headers.get('X-RateLimit-Remaining') || '0'));
      setLimit(parseInt(headers.get('X-RateLimit-Limit') || '0'));
    };

    // ... listen to API responses
  }, []);

  if (!remaining || !limit) return null;

  const percentage = (remaining / limit) * 100;
  const color = percentage > 50 ? 'green' : percentage > 20 ? 'orange' : 'red';

  return (
    <div>
      <progress value={remaining} max={limit} />
      <span style={{ color }}>
        {remaining}/{limit} requests remaining
      </span>
    </div>
  );
}
```

## Debugging Headers

### View in Browser DevTools

1. Open Network tab
2. Make API request
3. Check Response Headers section
4. Look for X-RateLimit-* headers

### curl Example

```bash
curl -i https://api.example.com/data

# Output:
# HTTP/1.1 200 OK
# X-RateLimit-Limit: 100
# X-RateLimit-Remaining: 75
# X-RateLimit-Reset: 1706123456
```

## Troubleshooting

### Headers Not Appearing

Check configuration:

```typescript
new RateLimitPlugin({
  includeHeaders: true,  // Must be true
})
```

Verify module configuration:

```typescript
new RateLimitPlugin({
  includeHeaders: true,  // Must be true (default)
})
```

### CORS Issues

Allow headers in CORS config:

```typescript
app.enableCors({
  exposedHeaders: [
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'Retry-After',
  ],
});
```

## Next Steps

- [Monitoring](./monitoring) — Track rate limits
- [Testing](./testing) — Test with headers
