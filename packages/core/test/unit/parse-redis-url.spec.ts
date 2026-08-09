import { describe, it, expect } from 'vitest';
import { parseRedisUrl, normalizeConnectionConfig } from '../../src/driver/application/parse-redis-url';
import { RedisXError } from '../../src/errors';
import type { ISingleConnectionConfig, IClusterConnectionConfig } from '../../src/types';

describe('parseRedisUrl', () => {
  it('parses host and port', () => {
    expect(parseRedisUrl('redis://cache.local:6380')).toMatchObject({ host: 'cache.local', port: 6380 });
  });

  it('parses username, password, and database from the path', () => {
    // Given
    const parsed = parseRedisUrl('redis://alice:s3cr3t@10.0.0.5:6379/3');

    // Then
    expect(parsed).toMatchObject({ host: '10.0.0.5', port: 6379, username: 'alice', password: 's3cr3t', db: 3 });
  });

  it('parses a password-only userinfo (redis://:pass@host)', () => {
    const parsed = parseRedisUrl('redis://:justapassword@localhost:6379');
    expect(parsed.password).toBe('justapassword');
    expect(parsed.username).toBeUndefined();
  });

  it('percent-decodes userinfo', () => {
    const parsed = parseRedisUrl('redis://user:p%40ss%3Aword@host:6379');
    expect(parsed.password).toBe('p@ss:word');
  });

  it('enables TLS for rediss://', () => {
    const parsed = parseRedisUrl('rediss://secure.upstash.io:6379');
    expect(parsed.tls).toEqual({ enabled: true });
  });

  it('omits fields not present in the URL', () => {
    const parsed = parseRedisUrl('redis://localhost');
    expect(parsed.port).toBeUndefined();
    expect(parsed.db).toBeUndefined();
    expect(parsed.password).toBeUndefined();
  });

  it('throws on a malformed URL', () => {
    expect(() => parseRedisUrl('not a url')).toThrow(RedisXError);
  });

  it('throws on an unsupported scheme', () => {
    expect(() => parseRedisUrl('http://localhost:6379')).toThrow(/Unsupported Redis URL scheme/);
  });

  it('throws on an invalid database number', () => {
    expect(() => parseRedisUrl('redis://localhost:6379/abc')).toThrow(/Invalid database number/);
  });
});

describe('normalizeConnectionConfig', () => {
  it('expands a url into concrete fields', () => {
    // Given
    const config: ISingleConnectionConfig = { url: 'rediss://u:p@h:6380/2' };

    // When
    const normalized = normalizeConnectionConfig(config) as ISingleConnectionConfig;

    // Then
    expect(normalized).toMatchObject({ host: 'h', port: 6380, username: 'u', password: 'p', db: 2 });
    expect(normalized.tls).toEqual({ enabled: true });
  });

  it('lets explicit fields override the url', () => {
    // Given — explicit port/db win over the URL's
    const config: ISingleConnectionConfig = { url: 'redis://h:6379/0', port: 7000, db: 5 };

    // When
    const normalized = normalizeConnectionConfig(config) as ISingleConnectionConfig;

    // Then
    expect(normalized.port).toBe(7000);
    expect(normalized.db).toBe(5);
    expect(normalized.host).toBe('h');
  });

  it('merges explicit TLS sub-options over rediss://', () => {
    // Given
    const config: ISingleConnectionConfig = { url: 'rediss://h:6379', tls: { rejectUnauthorized: false } };

    // When
    const normalized = normalizeConnectionConfig(config) as ISingleConnectionConfig;

    // Then
    expect(normalized.tls).toEqual({ enabled: true, rejectUnauthorized: false });
  });

  it('passes through a config without a url unchanged', () => {
    const config: ISingleConnectionConfig = { host: 'localhost', port: 6379 };
    expect(normalizeConnectionConfig(config)).toBe(config);
  });

  it('passes through cluster configs unchanged', () => {
    const config: IClusterConnectionConfig = { type: 'cluster', nodes: [{ host: 'h', port: 7000 }] };
    expect(normalizeConnectionConfig(config)).toBe(config);
  });
});
