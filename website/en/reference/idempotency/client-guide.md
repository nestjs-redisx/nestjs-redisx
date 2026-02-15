---
title: Client Guide
description: Client-side implementation for idempotent requests
---

# Client Guide

Implement idempotency on the client side.

## Generating Idempotency Keys

### UUID v4 (Recommended)

```javascript
// Browser
function generateIdempotencyKey() {
  return crypto.randomUUID();
}

// Result: "550e8400-e29b-41d4-a716-446655440000"
```

```typescript
// Node.js
import { randomUUID } from 'crypto';

const key = randomUUID();
// Result: "550e8400-e29b-41d4-a716-446655440000"
```

### Prefixed UUID

```javascript
function generatePaymentKey() {
  return `payment-${crypto.randomUUID()}`;
}

// Result: "payment-550e8400-e29b-41d4"
```

### Operation-Specific

```javascript
function generateOrderKey(userId, cartId) {
  return `order-${userId}-${cartId}-${crypto.randomUUID().slice(0, 8)}`;
}

// Result: "order-123-cart-456-550e8400"
```

## Storing Keys for Retry

### Local Storage

```javascript
class IdempotencyClient {
  generateKey(operation) {
    const key = crypto.randomUUID();
    localStorage.setItem(`idempotency:${operation}`, key);
    return key;
  }

  getKey(operation) {
    return localStorage.getItem(`idempotency:${operation}`);
  }

  clearKey(operation) {
    localStorage.removeItem(`idempotency:${operation}`);
  }
}

// Usage
const client = new IdempotencyClient();

// Creating order
const key = client.generateKey('checkout');
await api.createOrder(key, orderData);
client.clearKey('checkout');  // Success!
```

### Session Storage

```javascript
class SessionIdempotency {
  createKey(operation) {
    let key = sessionStorage.getItem(operation);

    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem(operation, key);
    }

    return key;
  }
}

// Usage: Same key throughout session
const key1 = idempotency.createKey('subscribe');
const key2 = idempotency.createKey('subscribe');
// key1 === key2 (same session)
```

## Making Idempotent Requests

### Fetch API

```javascript
async function createPayment(amount, currency) {
  const key = crypto.randomUUID();

  const response = await fetch('/api/payments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify({ amount, currency }),
  });

  if (!response.ok) {
    throw new Error(`Payment failed: ${response.status}`);
  }

  return response.json();
}
```

### Axios

```javascript
import axios from 'axios';

async function createOrder(orderData) {
  const key = crypto.randomUUID();

  try {
    const response = await axios.post('/api/orders', orderData, {
      headers: {
        'Idempotency-Key': key,
      },
    });

    return response.data;
  } catch (error) {
    if (error.response?.status === 422) {
      // Fingerprint mismatch - generate new key
      throw new Error('Invalid request data');
    }
    throw error;
  }
}
```

### cURL

```bash
# Generate UUID (macOS/Linux)
KEY=$(uuidgen)

# Make request
curl -X POST https://api.example.com/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY" \
  -d '{"amount": 100, "currency": "USD"}'
```

## Retry Strategy

### Automatic Retry with Same Key

```javascript
async function createPaymentWithRetry(data, maxRetries = 3) {
  const key = crypto.randomUUID();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: {
          'Idempotency-Key': key,  // Same key on retry
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        return await response.json();
      }

      if (response.status === 422) {
        // Fingerprint mismatch - don't retry
        throw new Error('Invalid request');
      }

      if (response.status === 408) {
        // Timeout - retry with same key
        console.log(`Attempt ${attempt} timed out, retrying...`);
        continue;
      }

      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### Conditional Retry

```javascript
async function createOrder(data) {
  const key = crypto.randomUUID();

  try {
    return await makeRequest(key, data);
  } catch (error) {
    if (isRetryable(error)) {
      console.log('Network error, retrying...');
      return await makeRequest(key, data);  // Same key
    }
    throw error;
  }
}

function isRetryable(error) {
  // Retry on network errors
  if (error.code === 'ECONNRESET') return true;
  if (error.code === 'ETIMEDOUT') return true;

  // Retry on 5xx errors
  if (error.response?.status >= 500) return true;

  // Don't retry on client errors
  return false;
}
```

## Handling Errors

### Fingerprint Mismatch (422)

```javascript
try {
  await createPayment(key, data);
} catch (error) {
  if (error.response?.status === 422) {
    // Key was used with different data
    // Generate new key and retry
    const newKey = crypto.randomUUID();
    await createPayment(newKey, data);
  }
}
```

### Timeout (408)

```javascript
try {
  await createOrder(key, data);
} catch (error) {
  if (error.response?.status === 408) {
    const retryAfter = error.response.headers['retry-after'];
    console.log(`Request timeout, retry in ${retryAfter}s`);

    // Wait and retry with SAME key
    await sleep(parseInt(retryAfter) * 1000);
    await createOrder(key, data);
  }
}
```

## Complete Example

### Payment Form

```javascript
class PaymentForm {
  constructor() {
    this.idempotencyKey = null;
  }

  async handleSubmit(event) {
    event.preventDefault();

    // Generate key on submit
    if (!this.idempotencyKey) {
      this.idempotencyKey = crypto.randomUUID();
    }

    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Processing...';

    try {
      const result = await this.createPayment({
        amount: this.getAmount(),
        currency: this.getCurrency(),
      });

      this.showSuccess(result);
      this.idempotencyKey = null;  // Clear for next payment
    } catch (error) {
      if (error.status === 422) {
        // Fingerprint mismatch - user changed data
        this.idempotencyKey = null;  // Generate new key
        this.showError('Please resubmit the form');
      } else {
        this.showError(error.message);
      }
    } finally {
      button.disabled = false;
      button.textContent = 'Pay Now';
    }
  }

  async createPayment(data) {
    const response = await fetch('/api/payments', {
      method: 'POST',
      headers: {
        'Idempotency-Key': this.idempotencyKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw { status: response.status, ...error };
    }

    return response.json();
  }
}

// Usage
const form = new PaymentForm();
document.getElementById('payment-form')
  .addEventListener('submit', (e) => form.handleSubmit(e));
```

## Best Practices

### Do

```javascript
// ✅ Generate fresh UUID for each operation
const key = crypto.randomUUID();

// ✅ Use same key on retry
await retryWithSameKey(key, data);

// ✅ Store key for pending operations
localStorage.setItem('pendingPayment', key);

// ✅ Clear key after success
localStorage.removeItem('pendingPayment');

// ✅ Handle fingerprint mismatch
if (error.status === 422) {
  key = crypto.randomUUID();  // New key
}
```

### Don't

```javascript
// ❌ Predictable keys
const key = Date.now().toString();

// ❌ Reuse key across different operations
createOrder(key, orderData);
createPayment(key, paymentData);  // Same key!

// ❌ Different key on retry
const key1 = crypto.randomUUID();
await makeRequest(key1);
// On retry:
const key2 = crypto.randomUUID();  // ❌ Wrong!
await makeRequest(key2);

// ❌ Hardcoded keys
const key = 'payment-123';  // ❌ Not unique!
```

## Testing

```javascript
describe('Idempotent requests', () => {
  it('should reuse key on retry', async () => {
    const key = crypto.randomUUID();

    // First request fails
    fetchMock.mockRejectedValueOnce(new Error('Network error'));

    // Retry succeeds
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => ({}) });

    await createPaymentWithRetry(key, data);

    // Both requests used same key
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers['Idempotency-Key']).toBe(key);
    expect(fetchMock.mock.calls[1][1].headers['Idempotency-Key']).toBe(key);
  });
});
```

## Next Steps

- [Recipes](./recipes) — Real-world examples
- [Troubleshooting](./troubleshooting) — Debug client issues
