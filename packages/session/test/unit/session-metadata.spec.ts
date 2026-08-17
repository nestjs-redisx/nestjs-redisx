import { describe, it, expect } from 'vitest';

import { parseSessionMetadata, isExpiredByCap, effectiveTtlMs, defaultUserIdExtractor } from '../../src/session/domain/session-metadata';

describe('parseSessionMetadata', () => {
  it('should parse a complete metadata hash', () => {
    // Given
    const hash = {
      userId: 'user-1',
      ip: '10.0.0.1',
      userAgent: 'Mozilla/5.0',
      createdAt: '1000',
      lastSeenAt: '2000',
      expiresAt: '90000',
    };

    // When
    const metadata = parseSessionMetadata(hash);

    // Then
    expect(metadata).toEqual({
      userId: 'user-1',
      ip: '10.0.0.1',
      userAgent: 'Mozilla/5.0',
      createdAt: 1000,
      lastSeenAt: 2000,
      expiresAt: 90000,
    });
  });

  it('should map empty optional fields to undefined', () => {
    // Given
    const hash = { userId: '', createdAt: '1000', lastSeenAt: '1000', expiresAt: '2000' };

    // When
    const metadata = parseSessionMetadata(hash);

    // Then
    expect(metadata?.userId).toBeUndefined();
    expect(metadata?.ip).toBeUndefined();
    expect(metadata?.userAgent).toBeUndefined();
  });

  it('should return null for an empty hash', () => {
    // When / Then
    expect(parseSessionMetadata({})).toBeNull();
  });

  it('should return null when timestamps are not finite numbers', () => {
    // Given
    const hash = { createdAt: 'not-a-number', lastSeenAt: '1000', expiresAt: '2000' };

    // When / Then
    expect(parseSessionMetadata(hash)).toBeNull();
  });
});

describe('isExpiredByCap', () => {
  it('should return false when no cap is configured', () => {
    // When / Then
    expect(isExpiredByCap(0, 1_000_000, undefined)).toBe(false);
  });

  it('should return false while the session is younger than the cap', () => {
    // When / Then
    expect(isExpiredByCap(1000, 1999, 1000)).toBe(false);
  });

  it('should return true once the session age reaches the cap', () => {
    // When / Then
    expect(isExpiredByCap(1000, 2000, 1000)).toBe(true);
    expect(isExpiredByCap(1000, 5000, 1000)).toBe(true);
  });
});

describe('effectiveTtlMs', () => {
  it('should return the requested TTL when no cap is configured', () => {
    // When / Then
    expect(effectiveTtlMs(60_000, 0, 1000, undefined)).toBe(60_000);
  });

  it('should clamp the TTL to the remaining cap window', () => {
    // Given: session created at 0, cap 10s, now 4s -> 6s remain

    // When / Then
    expect(effectiveTtlMs(60_000, 0, 4_000, 10_000)).toBe(6_000);
  });

  it('should keep the requested TTL when it is shorter than the remaining cap', () => {
    // When / Then
    expect(effectiveTtlMs(1_000, 0, 4_000, 10_000)).toBe(1_000);
  });

  it('should return 0 when the cap is already exhausted', () => {
    // When / Then
    expect(effectiveTtlMs(60_000, 0, 10_000, 10_000)).toBe(0);
    expect(effectiveTtlMs(60_000, 0, 20_000, 10_000)).toBe(0);
  });
});

describe('defaultUserIdExtractor', () => {
  it('should read the passport user id from the session payload', () => {
    // Given
    const session = { cookie: {}, passport: { user: 42 } };

    // When / Then
    expect(defaultUserIdExtractor(session)).toBe('42');
  });

  it('should return a string passport user id as-is', () => {
    // When / Then
    expect(defaultUserIdExtractor({ passport: { user: 'user-1' } })).toBe('user-1');
  });

  it('should return undefined when there is no passport user', () => {
    // When / Then
    expect(defaultUserIdExtractor({ cookie: {} })).toBeUndefined();
    expect(defaultUserIdExtractor({ passport: {} })).toBeUndefined();
    expect(defaultUserIdExtractor(null)).toBeUndefined();
    expect(defaultUserIdExtractor('string')).toBeUndefined();
  });
});
