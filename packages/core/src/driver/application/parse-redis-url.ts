import { RedisXError, ErrorCode } from '../../errors';
import { ConnectionConfig, ISingleConnectionConfig, isSingleConnection } from '../../types';

/**
 * Parses a Redis connection URL into single-connection config fields.
 *
 * Supports `redis://` and `rediss://` (TLS), optional `user:password@`
 * userinfo (percent-decoded), `host[:port]`, and a database number in the
 * path (`/0`). Returns only the fields present in the URL, so callers can
 * merge it under any explicitly-set config values.
 *
 * @throws {RedisXError} when the URL is malformed or uses an unsupported scheme
 */
export function parseRedisUrl(url: string): Partial<ISingleConnectionConfig> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RedisXError(`Invalid Redis URL: "${url}"`, ErrorCode.CFG_INVALID, undefined, { url });
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'redis:' && protocol !== 'rediss:') {
    throw new RedisXError(`Unsupported Redis URL scheme "${parsed.protocol}" (expected redis:// or rediss://)`, ErrorCode.CFG_INVALID, undefined, { url });
  }

  const result: Partial<ISingleConnectionConfig> = {};

  if (parsed.hostname) {
    result.host = decodeURIComponent(parsed.hostname);
  }
  if (parsed.port) {
    result.port = Number(parsed.port);
  }
  // userinfo — username may be empty while a password is present (redis://:pass@host)
  if (parsed.username) {
    result.username = decodeURIComponent(parsed.username);
  }
  if (parsed.password) {
    result.password = decodeURIComponent(parsed.password);
  }
  // database number lives in the path: redis://host:6379/2 -> db 2
  const dbSegment = parsed.pathname.replace(/^\//, '');
  if (dbSegment) {
    const db = Number(dbSegment);
    if (!Number.isInteger(db) || db < 0) {
      throw new RedisXError(`Invalid database number "${dbSegment}" in Redis URL`, ErrorCode.CFG_INVALID, undefined, { url });
    }
    result.db = db;
  }
  if (protocol === 'rediss:') {
    result.tls = { enabled: true };
  }

  return result;
}

/**
 * If a single-connection config carries a `url`, expands it into concrete
 * fields (host/port/username/password/db/tls) so every driver adapter sees a
 * normalized config. Explicitly-set fields take precedence over URL-derived
 * ones; TLS options set on the config are merged over `rediss://`. Cluster and
 * sentinel configs, and configs without a URL, pass through unchanged.
 */
export function normalizeConnectionConfig(config: ConnectionConfig): ConnectionConfig {
  if (!isSingleConnection(config) || !config.url) {
    return config;
  }

  const fromUrl = parseRedisUrl(config.url);

  return {
    ...fromUrl,
    ...config,
    // Merge TLS so `rediss://` enables TLS even when the config only tweaks
    // TLS sub-options (and an explicit tls on the config still wins per-field).
    tls: fromUrl.tls || config.tls ? { ...fromUrl.tls, ...config.tls } : undefined,
  };
}
