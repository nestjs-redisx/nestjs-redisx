import { describe, it, expect } from 'vitest';

import { CacheConfigError } from '../../src/shared/errors';
import type { CacheMode, ICachePluginOptions } from '../../src/shared/types';
import { validateCacheMode } from '../../src/shared/utils/validate-cache-mode';

describe('validateCacheMode', () => {
  describe('valid configurations', () => {
    it('accepts an undefined mode', () => {
      expect(() => validateCacheMode({})).not.toThrow();
    });

    it('accepts l1-l2', () => {
      expect(() => validateCacheMode({ mode: 'l1-l2', client: 'primary' })).not.toThrow();
    });

    it('accepts l1-only with L2-backed features enabled (they work in-memory)', () => {
      // Given l1-only with tags/SWR/stale-if-error explicitly ON
      const options: ICachePluginOptions = {
        mode: 'l1-only',
        l1: { maxSize: 500 },
        tags: { enabled: true },
        swr: { enabled: true },
        staleIfError: { enabled: true },
        invalidation: { source: 'internal' },
      };

      // When / Then — these are supported single-instance, so no throw
      expect(() => validateCacheMode(options)).not.toThrow();
    });
  });

  describe('invalid mode value', () => {
    it('throws CacheConfigError for an unknown mode', () => {
      expect(() => validateCacheMode({ mode: 'l3' as unknown as CacheMode })).toThrow(CacheConfigError);
    });
  });

  describe('l1-only conflicts (fail-fast)', () => {
    it('throws when a Redis client is named', () => {
      expect(() => validateCacheMode({ mode: 'l1-only', client: 'primary' })).toThrow(/client/);
    });

    it('throws when l1 is disabled (no cache left)', () => {
      expect(() => validateCacheMode({ mode: 'l1-only', l1: { enabled: false } })).toThrow(CacheConfigError);
    });

    it('throws when l2 is explicitly disabled (redundant/contradictory)', () => {
      expect(() => validateCacheMode({ mode: 'l1-only', l2: { enabled: false } })).toThrow(CacheConfigError);
    });

    it('throws when the invalidation source is AMQP (needs a broker)', () => {
      expect(() => validateCacheMode({ mode: 'l1-only', invalidation: { source: 'amqp' } })).toThrow(/AMQP/);
    });
  });
});
