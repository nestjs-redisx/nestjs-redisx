import { describe, it, expect, beforeEach } from 'vitest';

import { InMemoryL2StoreAdapter } from '../../src/cache/infrastructure/adapters/in-memory-l2-store.adapter';
import { CacheEntry } from '../../src/cache/domain/value-objects/cache-entry.vo';
import type { ICachePluginOptions } from '../../src/shared/types';
import { InMemoryTagIndexRepository } from '../../src/tags/infrastructure/repositories/in-memory-tag-index.repository';

const OPTIONS: ICachePluginOptions = {
  l1: { maxSize: 100 },
  l2: { keyPrefix: 'cache:' },
  tags: { maxTagsPerKey: 10 },
};

describe('InMemoryTagIndexRepository', () => {
  let store: InMemoryL2StoreAdapter;
  let tags: InMemoryTagIndexRepository;

  beforeEach(() => {
    store = new InMemoryL2StoreAdapter(OPTIONS);
    tags = new InMemoryTagIndexRepository(OPTIONS, store);
  });

  it('adds keys to tags and lists them as full (prefixed) keys', async () => {
    // Given
    await tags.addKeyToTags('cache:a', ['t1']);
    await tags.addKeyToTags('cache:b', ['t1', 't2']);

    // Then
    expect((await tags.getKeysByTag('t1')).sort()).toEqual(['cache:a', 'cache:b']);
    expect(await tags.getKeysByTag('t2')).toEqual(['cache:b']);
  });

  it('invalidateTag deletes the tagged values from the L2 store and returns the count', async () => {
    // Given values stored (unprefixed keys) and tagged (full keys)
    await store.set('a', CacheEntry.create(1, 3600));
    await store.set('b', CacheEntry.create(2, 3600));
    await tags.addKeyToTags('cache:a', ['t1']);
    await tags.addKeyToTags('cache:b', ['t1']);

    // When
    const count = await tags.invalidateTag('t1');

    // Then — values gone, tag cleared
    expect(count).toBe(2);
    expect(await store.get('a')).toBeNull();
    expect(await store.get('b')).toBeNull();
    expect(await tags.getKeysByTag('t1')).toEqual([]);
  });

  it('removeKeyFromTags drops a key and empties the tag', async () => {
    await tags.addKeyToTags('cache:a', ['t1']);
    await tags.removeKeyFromTags('cache:a', ['t1']);
    expect(await tags.getKeysByTag('t1')).toEqual([]);
    expect((await tags.getTagStats('t1')).exists).toBe(false);
  });

  it('invalidateTags sums deletions across tags', async () => {
    await store.set('a', CacheEntry.create(1, 3600));
    await store.set('b', CacheEntry.create(2, 3600));
    await tags.addKeyToTags('cache:a', ['t1']);
    await tags.addKeyToTags('cache:b', ['t2']);

    expect(await tags.invalidateTags(['t1', 't2'])).toBe(2);
  });

  it('clearAllTags empties the index but leaves values untouched', async () => {
    // Given
    await store.set('a', CacheEntry.create(1, 3600));
    await tags.addKeyToTags('cache:a', ['t1']);

    // When
    await tags.clearAllTags();

    // Then — index cleared, value survives (values are cleared separately)
    expect(await tags.getKeysByTag('t1')).toEqual([]);
    expect((await store.get<number>('a'))?.value).toBe(1);
  });

  it('getTagStats reports key count and existence', async () => {
    await tags.addKeyToTags('cache:a', ['t1']);
    expect(await tags.getTagStats('t1')).toEqual({ keyCount: 1, exists: true });
    expect(await tags.getTagStats('absent')).toEqual({ keyCount: 0, exists: false });
  });
});
