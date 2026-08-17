import { describe, it, expect } from 'vitest';

import { ttlMsFromSession } from '../../src/session/api/stores/session-cookie-ttl';

const NOW = 1_700_000_000_000;

describe('ttlMsFromSession', () => {
  it('should derive the TTL from cookie.expires', () => {
    // When / Then
    expect(ttlMsFromSession({ cookie: { expires: new Date(NOW + 30_000) } }, NOW, 5_000)).toBe(30_000);
  });

  it('should floor fractional expiry deltas', () => {
    // When / Then
    expect(ttlMsFromSession({ cookie: { expires: new Date(NOW + 1000) } }, NOW - 0.5, 5_000)).toBe(1_000);
  });

  it('should fall back when cookie.expires is an unparseable date', () => {
    // Given: a foreign serializer may store expires as a garbage string —
    // NaN must never reach the store (it would defeat the ttl <= 0 guard
    // and produce a PERSISTED key on real Redis)
    const session = { cookie: { expires: 'not-a-date' } };

    // When / Then
    expect(ttlMsFromSession(session, NOW, 5_000)).toBe(5_000);
    expect(ttlMsFromSession(session, NOW, undefined)).toBeUndefined();
  });

  it('should fall back when there is no cookie expiry', () => {
    // When / Then
    expect(ttlMsFromSession({ cookie: {} }, NOW, 5_000)).toBe(5_000);
    expect(ttlMsFromSession(null, NOW, undefined)).toBeUndefined();
  });

  it('should return non-positive TTLs for already-expired cookies (caller destroys)', () => {
    // When / Then
    expect(ttlMsFromSession({ cookie: { expires: new Date(NOW - 1000) } }, NOW, 5_000)).toBe(-1_000);
  });
});
