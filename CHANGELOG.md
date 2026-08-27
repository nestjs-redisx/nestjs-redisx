# Changelog

All notable changes to NestJS RedisX are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.12.0] - 2026-08-17

### Added

- **New package `@nestjs-redisx/session`** — Redis session management ("Spring Session for NestJS"). Closes #48.
  - **Drop-in middleware store**: `toExpressStore()` / `toFastifyStore()` implement the `express-session` and `@fastify/session` store contracts over the RedisX driver (standalone/cluster/sentinel, named clients). Cookie crypto, session-fixation defense, and ID rotation stay with the middleware; Passport, `req.session`, and the connect ecosystem keep working untouched — migration from `connect-redis` is one line. Both middleware packages are **optional peer dependencies**; `toExpressStore` loads `express-session` lazily and explains what to install when it is missing (`SessionMiddlewareMissingError`).
  - **`SESSION_SERVICE` (`ISessionService<T>`)** — the capabilities the Store contract cannot offer, over the same keys: `getSession`, `getSessionsByUser` (the GitHub-style device page with IP / user agent / `createdAt` / `lastSeenAt` metadata), `count`, `countByUser`, `revoke`, `revokeAll` (password change / compromise), `revokeAllExcept` ("log out everywhere else"), and `recordActivity` (opt-in request-metadata stamping). User attribution via `userIdExtractor` — defaults to the Passport convention (`session.passport.user`), configurable for custom auth; unattributed sessions are stored but not user-indexed.
  - **Security policies**: `maxSessionsPerUser` seat limits with `'reject'` (atomic per-user Lua reservation, surfaces as `SessionLimitExceededError` through the middleware save / `req.logIn` callback) or `'evict-oldest'` (by `createdAt`); `absoluteLifetimeMs` lifetime cap (PCI DSS / OWASP forced re-login) — every TTL is clamped to the remaining window so sessions die on time even without traffic, and pre-cap sessions are destroyed on next access.
  - **Observability**: fire-and-forget lifecycle events (`onCreated` / `onDestroyed` / `onRevoked` / `onExpiredByCap`) and, when `MetricsPlugin` is present, `redisx_session_created_total`, `redisx_session_destroyed_total{reason}`, `redisx_session_limit_rejections_total`.
  - **Storage design**: middleware payload stored as-is (never re-serialized) hash-tagged with a metadata hash for cluster-atomic Lua; per-user and global ZSET indexes (`sid -> expiresAt`) swept lazily by score — accurate counts with no SCAN. Corrupt payloads self-heal (destroyed and treated as a miss). Runs fully on the `@nestjs-redisx/testing` in-memory driver, Lua included; the e2e suite drives real `express-session` (passport-style login → device page → `revokeAllExcept` → old cookie rejected) and real `@fastify/session`.
- `core`: `SESSION_*` error codes (`SESSION_STORE_ERROR`, `SESSION_CONFIG_INVALID`, `SESSION_LIMIT_EXCEEDED`, `SESSION_MIDDLEWARE_MISSING`, `SESSION_SERIALIZATION_FAILED`).
- `session`: **adversarial-hardening pass** (pre-release fixes found by targeted attack testing):
  - index keys now carry their own TTL, refreshed on every save AND touch — rolling sessions (`resave: false` + `touch`) could previously outlive their per-user index, silently breaking `revokeAll`/`revokeAllExcept`, the device page, and seat limits, and a later touch recreated the index key without any expiry;
  - reject-policy reservations are clamped to the absolute lifetime cap and released when the session write fails — a capped-out or failed login could previously burn a seat for up to `defaultTtlMs` (deterministic lockout under `maxSessionsPerUser` + `absoluteLifetimeMs`);
  - re-saving a session under a different user (account switch without sid regeneration) now removes it from the previous owner's index — the old owner's device page could previously list, and expose the payload of, the new owner's session;
  - the absolute lifetime cap re-arms (and persists) `createdAt` when session metadata is lost, instead of resetting the window on every touch — a session without metadata could previously become immortal;
  - TTLs are validated (positive, finite, floored) at the store boundary and unparseable `cookie.expires` values fall back instead of producing `NaN` — a `NaN`/fractional TTL previously aborted the Lua script between `SET` and `PEXPIRE` on real Redis, leaving a persisted, metadata-less session key;
  - middleware store callbacks are invoked exactly once even when the application callback throws (the `.then(cb).catch(cb)` chain re-entered it with its own error);
  - `userIdExtractor` results are normalized (non-empty strings; finite numbers stringified) — an empty-string user id previously created permanently orphaned `sess:user:` index entries; `null` payloads and non-positive TTLs are rejected instead of writing ghost sessions; a throwing metrics service no longer converts successful writes into errors.
- `session`: **second adversarial-hardening pass** (a fresh attack round against the hardened code):
  - the compensating `zrem` after a failed write is now guarded by a liveness probe — a failed **re-save** (or a write that timed out but landed) previously un-indexed a LIVE session, making it invisible to the device page and `revokeAll` and freeing its seat;
  - `destroy` recovers ownership from the metadata even when the payload is already gone, and from the payload when the metadata is gone — destroy is the public repair path for a dirty per-user index, and it previously discarded the owner it had just read (phantom seat → `reject` lockout until the entry swept);
  - reading a session whose metadata was evicted now heals the full timestamp triple and re-derives the owner via `userIdExtractor`, re-scoring both indexes — such a session was previously alive but permanently orphaned from its user (unrevocable, absent from the device page, `metadata: null`);
  - `getSessionsByUser` / `revokeAll` / `revokeAllExcept` verify the owner recorded in each session's metadata, so a stale index entry left by an account switch on the same sid can never expose or destroy another user's session; stale entries whose session is gone are still cleaned by revocation (index self-repair);
  - TTLs and `defaultTtlMs` / `absoluteLifetimeMs` are bounded (safe integers, ≤ 10 years, exported as `MAX_SESSION_TTL_MS`) — `1e21` passed `Number.isInteger` and aborted `PEXPIRE` mid-script after the payload `SET`, leaving a persisted, uncappable key;
  - `keyPrefix` rejects `{`/`}` — a prefix with an empty hash tag split payload and metadata across cluster slots for every session (`CROSSSLOT`) while booting happily;
  - the express `touch` path destroys an already-expired session instead of throwing an invalid-TTL error inside express-session's response-end path (`cookie.maxAge: 0` produced a 500);
  - fixed the repo `typecheck` gate (`reserve()` was called with numeric flags; the express store's `touch` needed an `override` modifier).
- `rate-limit`: **in-memory (per-instance) store with per-route selection** — a second store backend for deployments where the Redis round-trip on the request path is the bottleneck (e.g. a far cluster node adding latency to every request: a key hashes deterministically to one shard, so some users always pay the slow path).
  - New plugin option `store: 'redis' | 'memory'` (default `'redis'`, fully backward compatible) sets the default for all routes; `@RateLimit({ store })` and `check/peek/getState(key, { store })` override it per route/call **in either direction**. Both adapters are always registered (`RATE_LIMIT_MEMORY_STORE` token), so a `'memory'` default with `'redis'` pinned on auth-sensitive routes (login, OTP, password reset — where a distributed brute force would otherwise multiply a per-node threshold by the node count) works out of the box.
  - The memory store counts in process memory with **exact result parity** with the Lua scripts (same numbers, rounding, and `retryAfter` semantics for all three algorithms; verified by a parity suite that runs the same scenarios against both stores). Node's event loop makes each check atomic.
  - Memory safety under key spray: `memory.maxKeys` cap (default `100000`, approximate-FIFO eviction) plus a lazy-started, `unref`'d sweep of expired entries (`memory.sweepIntervalMs`, default `30000`).
  - `reset(key)` now sweeps **both** stores across all algorithm variants; `reset(key, { store })` targets one. Redis-backed keys clear globally; memory-backed keys clear on the executing instance only (short windows self-heal elsewhere — routes that need global reset belong on `store: 'redis'`).
  - Fail-fast validation of the new options on both the plugin and per-call paths via `InvalidRateLimitConfigError` (new core `ErrorCode.RATE_LIMIT_CONFIG_INVALID`); configuration errors are never masked by `errorPolicy: 'fail-open'`.
- `testing`: the memory Lua interpreter now converts nil Redis replies into Lua `false` (real Redis semantics) — `if x == false` / missing-reply branches previously diverged from production behavior on the in-memory driver.

### Fixed

- `rate-limit`: **`reset()` now actually clears fixed-window counters.** The fixed-window script kept its counter in a per-window subkey (`{key}:<window>`) while `reset()` deleted only the bare key, so resetting a fixed-window limit was silently a no-op. Fixed-window state now lives in a `{window, count}` hash at the bare key (still one key and cluster-safe, no hash tags needed); `peek()` reads the same hash and ignores stale windows. During a rolling deploy old and new instances briefly count in separate keys for fixed-window routes (limits stay enforced, momentarily per-fleet-half); old subkeys expire on their own.
- `rate-limit`: the package `test:integration` script ran a single hardcoded spec file; it now runs the whole `test/integration` directory sequentially (the token-bucket peek spec was previously never executed by it).

## [1.11.0] - 2026-08-16

### Added

- `tracing`: **`provider` option (`'auto'` | `'external'` | `'standalone'`, default `'auto'`)** — the plugin now integrates with an application's existing OpenTelemetry setup instead of competing with it. Previously it always constructed and registered its own `NodeTracerProvider`: initialized after the app's SDK it silently ran an orphan pipeline (an OTLP exporter that received nothing, yet was the one shut down on close); initialized first, it captured the application's spans into the plugin's exporter. Now, when a global tracer provider is already registered, the plugin becomes a pure `@opentelemetry/api` consumer — RedisX spans flow through the app's exporter and sampler, and the plugin **never overrides** a registered provider (`'standalone'` warns and uses the app's provider instead). An own provider is built only when no global provider exists (`'auto'`, preserving the 1.10.0 out-of-the-box behavior) or on explicit `'standalone'`. The OpenTelemetry SDK packages are loaded via dynamic `import()` strictly on the own-provider path — apps with their own SDK never load the plugin's copy; `@opentelemetry/api` is the only static OpenTelemetry import left.
- `tracing`: **duplicate-span protection** for the native command hook. With `@opentelemetry/instrumentation-ioredis` (or `instrumentation-redis-4`) active, both the instrumentation and the hook would emit a span per Redis command. The hook now detects an active instrumentation (shimmer `__wrapped` probe, evaluated per command — late enable and runtime `disable()` are both handled) and pauses itself, logging once per state change. `traceRedisCommands: 'force'` emits both deliberately.
- `metrics`: **`registry` option (`'own'` | `'default'` | `Registry` instance, default `'own'`)** — register RedisX metrics into the application's existing prom-client registry so they appear on the app's own `/metrics` endpoint (combine with `exposeEndpoint: false`). With an external registry the plugin behaves as a guest: on shutdown it removes only its own metrics (never `clear()`s the registry), `defaultLabels` are applied only when explicitly configured, and `collectDefaultMetrics` becomes opt-in (the application almost certainly collects process metrics there already). The `'own'` default keeps the 1.10.0 behavior unchanged.

### Changed

- `metrics`: `prom-client` moved from a bundled dependency to a **peer dependency** (auto-installed by npm 7+ / pnpm 8+; yarn classic users add it to their dependencies). This is what makes the `registry` option safe: plugin and application always share a single prom-client instance, so a passed-in `Registry` is guaranteed to be compatible.

## [1.10.0] - 2026-08-11

### Added

- `cache`: **`mode: 'l1-only'`** — run the cache entirely in local process memory, with **no Redis**. The app boots even when Redis is unreachable — previously `l2.enabled: false` was not enough, because `RedisModule` connects its default client at startup regardless of the cache. In `l1-only` the L2 tier is served by an in-memory store that keeps the **live** object (the same instance L1 holds), so a value is stored once and shared across tiers with no duplication — which matters for large values. Tags, SWR, stale-if-error and stampede singleflight all keep working, **single-instance** (per process); size the cache via the `l1` block. Fail-fast `CacheConfigError` at bootstrap when `l1-only` is combined with something that genuinely needs Redis or an external broker (`client`, `l1.enabled: false`, `l2.enabled: false`, `invalidation.source: 'amqp'`); storage-backed features (tags/SWR/stale-if-error) are not rejected because they work in memory. The default `mode: 'l1-l2'` is unchanged and requires Redis as before. Exposes the `CacheMode` type. This is distinct from the per-call `strategy: 'l1-only'`, which only skips the L2 write for one value in an otherwise Redis-backed app. Closes #14, #15.

## [1.9.2] - 2026-08-09

### Changed

- `cache`: key validation no longer rejects `/` (and other URL characters) by default. The validator previously allowed only `[A-Za-z0-9-_:.]`, so URL / path keys — the natural key for HTTP-response caching — threw `CacheKeyError` on write and silently missed on read (Redis keys are binary-safe; the restriction was artificial). The new default `keys.validation: 'safe'` rejects only what is genuinely dangerous (empty keys, whitespace, control characters) and allows everything else, so `cache.getOrSet('http:/api/users/123', …)` works out of the box. The previous behavior is available as `keys.validation: 'strict'`.

### Added

- `cache`: `keys.validation` option — `'safe'` (default), `'strict'` (the historical `[A-Za-z0-9-_:.]` allowlist), or `'off'` (only empty + length checks) — plus `keys.pattern` for a custom allowlist `RegExp` that overrides the mode. Exposed `KeyValidationMode` / `ICacheKeyOptions`. For arbitrary URLs (especially with query strings) the docs recommend hashing the URL with `hashKey()` for a bounded, collision-resistant key.

## [1.9.1] - 2026-08-09

### Fixed

- `cache`: `{n}` tag-template interpolation is now applied in **all** proxy decorators, not just `@Cached`. In 1.9.0 `@Cached` interpolated static `tags` (`['user:{0}']` → `['user:42']`) but `@InvalidateTags` and `@InvalidateOn` still took them literally — so a value cached under tag `user:42` was never invalidated by `@InvalidateTags({ tags: ['user:{0}'] })` (which targeted the literal `user:{0}`, and even threw on the `{}` characters). All three decorators now share one `interpolateTags` implementation, so the tag written on read and the tag invalidated on write are produced identically. A cross-decorator round-trip test (cache write → invalidate → re-read misses) guards against the asymmetry regressing. The legacy interceptor decorators (`@Cacheable`/`@CacheEvict`) use the named-parameter (`{param}`) syntax and are internally consistent (both literal); templated tags there remain a separate, non-dangerous feature gap.

## [1.9.0] - 2026-08-09

### Security

- `rate-limit`: **client IP is no longer derived from spoofable forwarding headers by default.** `getClientIp` previously read `X-Forwarded-For` / `X-Real-IP` unconditionally, so any client could set the header and mint a fresh rate-limit bucket per request — bypassing throttling on login/password-reset endpoints. The IP now comes from the framework (`request.ip`, which honors the app's own `trust proxy` / `trustProxy` setting and is un-spoofable). Reading forwarding headers is opt-in via the new `trustProxy: true` (enable only behind a trusted proxy that overwrites them).

### Changed

- `rate-limit`: a store (Redis) failure under the default `errorPolicy: 'fail-closed'` now returns **`503 Service Unavailable`** instead of an uncaught **`500`**. The built-in filter previously only caught `RateLimitExceededError`; `RateLimitScriptError` (raised on store failure) is not a subclass, so every request 500'd while Redis was down. The filter now catches the base `RateLimitError` and maps exceeded → 429, store failure → 503 (matching the already-documented behavior).
- `cache`: `@Cached` static `tags` now interpolate `{n}` argument placeholders like `key` does — `tags: ['user:{0}']` becomes `['user:42']` instead of the literal `user:{0}` (which silently never matched on invalidation).

### Added

- `core`: single connection config accepts a **`url`** (e.g. `REDIS_URL`) — `redis://user:pass@host:6379/0`, `rediss://` for TLS, DB number in the path. Parsed into `host`/`port`/`username`/`password`/`db`/`tls`; explicitly-set fields override URL-parsed ones. Exposes `parseRedisUrl` / `normalizeConnectionConfig`. Removes the need to hand-parse `REDIS_URL` for Heroku/Railway/Upstash/docker-compose deployments.
- `rate-limit`: new options `trustProxy` (default `false`) and `registerExceptionFilter` (default `true`, set `false` to handle `RateLimitError` with your own filter and response envelope).
- `core`: `useFactory` in `forRootAsync` / plugin `registerAsync` is now typed `(...args: any[])` (matching NestJS) so a strongly-typed factory such as `(config: ConfigService) => ({ ... })` compiles under `strict` — previously `unknown[]` rejected it via parameter contravariance and forced an in-body cast.

### Fixed

- `cache`: `@Cached` on a method that throws (e.g. a `NotFoundException` from a "find or throw 404" method) previously logged the error as a cache failure and, fail-open, **executed the method a second time** (double DB hit). Loader errors are now told apart from cache-infrastructure errors: the original error propagates unchanged, the method runs once, and nothing is logged; fail-open re-execution happens only on a genuine cache failure (Redis unreachable, serialization).

## [1.8.1] - 2026-08-08

### Fixed

- `cache`: `hashKey()` / `stableStringify()` collapsed every `Map` and `Set` to `{}` — all Maps (and all Sets) serialized identically, so distinct inputs produced the same cache key and could receive each other's cached values (this also affected `@Cached` auto-generated keys for methods taking Map/Set arguments). Maps now serialize as sorted, type-prefixed entries and Sets as sorted, type-prefixed items; the Map entry order is sorted by the `(key, value)` pair so it is fully insertion-order-independent even when distinct object keys share the same canonical form. Keys for values that do not contain a Map or Set at any depth are byte-identical (existing golden vectors unchanged). The idempotency package's `canonicalStringify` is updated in parity. Thanks [@qrver](https://github.com/qrver) ([#13](https://github.com/nestjs-redisx/nestjs-redisx/pull/13)).
- `idempotency`: `generateLegacyFingerprint` was declared `async` without an `await` (a lint warning shipped in 1.8.0); it is now synchronous. No behavior change.

## [1.8.0] - 2026-08-08

### Fixed

- `idempotency`: the default request fingerprint is now **canonical** — the body (and `query`, when included) is serialized with recursively sorted object keys, so two semantically identical bodies that differ only in key order (re-serialized by a proxy, built by a different client, generated by an LLM) no longer produce a false `422 fingerprint mismatch`. Records written by previous versions keep replaying during the upgrade window: on a mismatch the interceptor retries once with the legacy (order-sensitive) fingerprint before rejecting. The docs previously suggested `JSON.stringify(body, Object.keys(body).sort())` as a workaround — that replacer-array form is an allow-list that silently **drops nested keys** from the fingerprint; the advice is removed and warned against.
- `idempotency`: `complete()`/`fail()` now write the record fields **and** the TTL in a single atomic Lua script. Previously `HMSET` and `EXPIRE` were two separate commands: a crash between them either left the response under the leftover lock TTL (early expiry → duplicate execution) or — when the record had already expired mid-handler — re-created the key **without any TTL** (immortal record, memory leak).
- `idempotency`: the stale-lock takeover branch in the check-and-lock Lua script was dead code — the processing record's TTL equaled the staleness threshold, so by the time a lock could be considered stale the key was already gone (takeover degraded to an expire-then-race at the service level). Processing records are now retained for **2x `lockTimeout`**: once the original attempt exceeds `lockTimeout` without completing, the next request or waiter takes the lock over **atomically inside the script** (exactly one contender wins; the rest keep waiting on the new owner's record). `waitForCompletion` detects stale — not just vanished — records.

### Added

- `cache`: **stale-if-error** (RFC 5861) — serve the last known value when the loader **fails**, as a first-class availability policy independent of SWR (the freshness policy). Implements the core of [#11](https://github.com/nestjs-redisx/nestjs-redisx/issues/11) (retry backoff tracked separately). Configured as an object sibling to `swr`: `staleIfError: { enabled, defaultWindow, shouldServe }` at the plugin level, with per-call (`getOrSet`) and per-method (`@Cached`) overrides. Entries are physically retained for `window` seconds beyond their normal expiry (`keepUntil = ttl + staleTime + window`); between expiry and `keepUntil` the value is invisible to the success path — a healthy loader reloads fresh data — and is served **only** when the loader throws. `shouldServe(error)` filters which errors qualify (default: any; exclude 404/410-style "data is gone" errors so dead data is never served forever). Retries are lazy and request-driven, coalesced by stampede protection. Every stale-on-error serve logs a warning and increments `redisx_cache_stale_if_error_served_total`, so an outage cannot hide behind a green cache. The window must be a finite number — validated fail-fast at bootstrap and per call (`CacheConfigError`, new `ErrorCode.CACHE_CONFIG_INVALID`); entries of non-users keep exactly the previous TTL.
- `cache`: public **`hashKey(value)`** — hash any JSON-serializable value into a stable, CacheKey-safe 16-hex segment using the SAME frozen algorithm the `@Cached` decorator uses for auto-generated keys ([#12](https://github.com/nestjs-redisx/nestjs-redisx/issues/12)) (recursive key-sorted serialization + SHA-256 truncated to 64 bits). `{a:1,b:2}` and `{b:2,a:1}` produce the same key at every nesting level; Date/BigInt/undefined are handled. Built for the manual path — `cache.getOrSet(`calc:${hashKey(dto)}`, loader)` — so nobody has to hand-roll a key sorter. `stableStringify(value)` (the canonical serialization) is exported too, and `KeyBuilder.hashStable(obj)` adds the same hash as a fluent segment. The algorithm is a frozen contract: it will never change in place; guarded by golden-vector tests.
- `cache`: `KeyBuilder.hash()` is **deprecated** (removal in 2.0): it is key-order-sensitive (`{a:1,b:2}` ≠ `{b:2,a:1}`) and 32-bit — collisions become likely at tens of thousands of distinct objects, and a collision makes the cache serve the wrong value. Its output is intentionally unchanged so existing keys keep working; migrate to `hashStable()` / `hashKey()`.
- `idempotency`: the exception filter's response body now carries a machine-readable `code` (e.g. `IDEMPOTENCY_TIMEOUT` vs `IDEMPOTENCY_FAILED`), so clients can distinguish the 409 variants — concurrent request still in progress vs previous attempt failed — without parsing the human-readable message.
- `idempotency`: documentation now states explicitly that `defaultTtl` is the deduplication **window** (a retry after expiry re-executes; keep the durable "was this operation performed" answer in your database for money movement), that `errorPolicy: 'fail-open'` trades the idempotency guarantee for availability, and how to register the interceptor for byte-accurate response replay (idempotency outermost, response transforms deeper).

## [1.7.0] - 2026-08-03

### Added

- `@nestjs-redisx/pubsub`: new package — typed Redis Pub/Sub for real-time cross-instance messaging. Provides `PubSubPlugin`, `PUBSUB_SERVICE` (`publish` / `subscribe` / `psubscribe` / `unsubscribeAll` / `getSubscriptions`), and a `@Subscribe` decorator with automatic discovery for channels and Redis glob patterns. Payloads are JSON-serialized with generics; non-JSON messages from other systems are delivered as raw strings (fail-open interop). The plugin creates and manages a **dedicated subscriber connection** (`<client>:pubsub-subscriber`) cloned from the named client's config and driver — a Redis connection in subscriber mode cannot execute regular commands, so your main client keeps working. Multiple handlers per channel multiplex over a single Redis subscription; the subscription is released when the last handler unsubscribes, and everything cleans up on shutdown. Handler errors are isolated (logged, never break the dispatch loop). Optional `channelPrefix` namespaces events without leaking into handler-visible names.
- `core`: the driver layer now delivers Pub/Sub messages — `DriverEvent.MESSAGE` / `DriverEvent.PMESSAGE` events are emitted by both drivers (`ioredis` native events; `node-redis` via its v4 listener-based `subscribe` API). With the `node-redis` driver, Pub/Sub is supported on single-node connections; `subscriptionClient()` throws a clear error on Cluster/Sentinel (use `ioredis` for those topologies).
- `core`: `RedisClientManager` now records each client's `driverType` in its metadata, and `createClient()` honors a per-client driver override — so runtime-created clients (like the Pub/Sub subscriber) inherit the right driver (including the in-memory test driver).
- `@nestjs-redisx/testing`: the in-memory driver now implements `PUBLISH` / `SUBSCRIBE` / `UNSUBSCRIBE` / `PSUBSCRIBE` / `PUNSUBSCRIBE` via a process-wide Pub/Sub bus with glob pattern matching — the real `PubSubPlugin` (including its dedicated subscriber client) round-trips messages hermetically in unit tests.
- `tracing`: `traceRedisCommands` now actually works — every command executed through RedisX drivers is wrapped natively in a `redis.<COMMAND>` CLIENT span (previously the option only logged a warning about an external instrumentation package). Command spans cover all named clients and runtime-created connections (e.g. the Pub/Sub subscriber), carry `db.system` / `db.operation` / `db.statement` / `redisx.client` / `redisx.duration_ms`, honor `spans.excludeCommands` / `includeArgs` / `includeResult` / `maxArgLength`, record exceptions with ERROR status, and parent onto the active trace context — a cache lookup shows up inside the HTTP request's trace.
- `core`: drivers support a command hook (`IRedisDriver.setCommandHook`, `RedisClientManager.setCommandHook`) — observability plugins can wrap every command executed on all current and future clients; custom drivers without hook support are skipped gracefully.

### Changed

- `tracing`: the default sampling strategy is now `'parent'` (a `ParentBasedSampler` with a `ratio` fallback for root spans), matching the OpenTelemetry SDK convention. Previously the default was `'always'`, which emitted RedisX spans even for requests whose own trace was not sampled upstream — orphaned spans and wasted volume. Standalone behavior is unchanged (root spans fall back to `ratio`, default 1.0); set `sampling: { strategy: 'always' }` explicitly to restore the old behavior.
- `tracing`: `traceHttpRequests` now warns only when `@opentelemetry/instrumentation-http` is actually missing (previously it warned unconditionally, even when the package was installed), and the message explains that HTTP instrumentation must be registered in the application's own OpenTelemetry bootstrap (it has to load before the `http` module).

## [1.6.1] - 2026-07-24

### Fixed

- `idempotency`: a duplicated interceptor binding (global `APP_INTERCEPTOR` + `@Idempotent`, controller-level `@UseInterceptors` + method decorator, or manual registration) caused a **self-deadlock**: the inner pass saw its own `processing` record and waited for it until the lock TTL expired (~30 s), then surfaced an unexplained 500. Idempotency now engages at most once per request via a per-request marker (same pattern as the rate-limit guard).
- `idempotency`: when the first attempt died between `checkAndLock` and `complete` (its `processing` record expired by lock TTL), every concurrent waiter got `IdempotencyRecordNotFoundError` → 500. A waiter now atomically **takes over** the lock and executes the request itself; losers keep waiting on the new owner's record. As a backstop the filter maps `IdempotencyRecordNotFoundError` to a retryable 409 instead of 500.
- `idempotency`: `complete()`/`fail()` now persist the request **fingerprint**. Previously a handler that outlived `lockTimeout` re-created the record without a fingerprint, and every later replay of the same key was misread as a mismatch (422).
- `idempotency`: fire-and-forget `complete()`/`fail()` rejections (e.g. Redis blips after the response was sent) are now logged instead of becoming unhandled promise rejections.
- `idempotency`: the package `test:integration` script pointed at a non-existent spec file and silently ran nothing; it now runs the whole directory sequentially.
- `idempotency`: a duplicated `Idempotency-Key` header (array) now uses the first value instead of producing a garbage key.

### Added

- `idempotency`: `validateFingerprint` now actually works (it was a documented no-op — the fingerprint was always compared). `false` at the plugin or `@Idempotent` level replays a reused key without comparing request contents. Also plugged through per-call `IIdempotencyOptions.validateFingerprint`.
- `idempotency`: plugin options are validated at bootstrap (`defaultTtl`/`lockTimeout`/`waitTimeout` must be positive) — invalid values throw `IdempotencyConfigError` instead of silently breaking TTL semantics (e.g. `lockTimeout: 0` deleted the processing record instantly).

## [1.6.0] - 2026-07-24

### Added

- `@nestjs-redisx/circuit-breaker`: new package — a distributed circuit breaker (`closed` / `open` / `half-open`) backed by Redis. At its core is a pure, time-injected finite state machine (`CircuitBreakerState`) that takes an explicit `now` (no hidden `Date.now()`), so the policy is deterministic and fully unit-testable; the distributed layer replicates it 1:1 with atomic Lua scripts. Provides `CircuitBreakerPlugin`, `CIRCUIT_BREAKER_SERVICE` (`execute` with fallback, manual `recordSuccess` / `recordFailure`, `getState`, `reset`), and a proxy-based `@WithCircuitBreaker` decorator that works on any Injectable method (key interpolation, per-method overrides, `fallback`, `onOpen`, and `skip`). Half-open probes whose outcome is never recorded (e.g. a crashed process) are auto-reclaimed after `probeTimeoutMs` (default: `openDurationMs`). Honors `errorPolicy` (`fail-open` / `fail-closed`) when the state store is unavailable, and works on Redis Cluster (state keys share a hash tag). Also runs on the `@nestjs-redisx/testing` in-memory driver.
- `core`: added `CIRCUIT_BREAKER_OPEN`, `CIRCUIT_BREAKER_STORE_ERROR`, and `CIRCUIT_BREAKER_CONFIG_INVALID` to `ErrorCode`.

### Fixed

- `cache`: stampede protection served **stale (pre-invalidation) values for up to 100 ms** after any load. A completed singleflight stayed in the in-process flight map (`setTimeout(delete, 100)`), so the pattern "mutation → `invalidateTags`/`delete` → immediate `getOrSet`" (SSE / TanStack Query refetch) coalesced onto the already-resolved flight: the loader was not called, the old value was returned with `stampedePrevented` incremented, and the cache was not re-populated. The same lingering window could also hang a caller for the full `waitTimeout` if it attached to a flight whose loader had failed with no waiters. Flights are now removed **synchronously** on completion — in-flight waiters are unaffected (they already hold the promise), and sequential calls always re-check the cache and reload.
- `cache`: cross-instance stampede protection is now real. Previously, when the distributed lock was held by another instance, the loader ran anyway (one duplicate load per process). Now the non-leader instance waits for the lock to clear (bounded by `waitTimeout`, 50 ms polls) and re-reads the value the leader cached — the load happens once across all instances; if the leader failed or the wait times out, the instance falls back to loading locally. To make this sound, the cache write now happens **inside** the protected section (before the lock is released), which also removes a duplicate write on the SWR miss path (a plain `CacheEntry` was written and immediately overwritten by the SWR entry).
- `cache`: the package `test:integration` script pointed at a non-existent spec file and silently ran nothing; it now runs the whole `test/integration` directory sequentially.

## [1.5.1] - 2026-07-19

### Fixed

- `cache`: L1 (in-memory) entries expired ~60 ms after being written. `CacheService` passes the L1 TTL in **seconds** (per the public `l1.ttl` config), but `L1MemoryStoreAdapter` treated the value as **milliseconds** when computing `expiresAt`, so a `@Cached` value effectively lived a few milliseconds and almost every read was an L1 miss (falling through to L2). The L1 store now consistently interprets TTL in seconds, matching the config, the L2 store, and the docs. Fixes [#10](https://github.com/nestjs-redisx/nestjs-redisx/issues/10).

## [1.5.0] - 2026-06-28

### Added

- `@nestjs-redisx/testing`: new package — an in-memory Redis driver for unit-testing without a running Redis. It runs the real `cache`, `locks`, `rate-limit`, `idempotency`, and `streams` plugins — including their Lua scripts and stream consumer groups (PEL, `XACK` / `XCLAIM` / `XPENDING`) — entirely in memory. Exposes `RedisTestingModule` (a `RedisModule` wrapper that forces the `'memory'` driver), `registerMemoryDriver()`, and `MemoryRedisAdapter`. Install it as a devDependency.
- `core`: a driver registry (`registerDriver()`) lets first-party packages plug in an alternative `IRedisDriver` implementation (used by `@nestjs-redisx/testing`) without modifying core. Built-in `ioredis` / `node-redis` types cannot be overridden; `DriverType` is widened to accept registered custom type strings.

## [1.4.0] - 2026-06-23

### Added

- `cache`: `stampede.fallback` (`'load'` | `'error'` | `'null'`, default `'load'`) is now honored when stampede protection times out — previously the option was inert and the service always threw `StampedeError`.
- `idempotency`: `errorPolicy` (`'fail-open'` | `'fail-closed'`) is now honored when the store is unavailable. A built-in exception filter now maps idempotency errors to meaningful HTTP status codes (fingerprint mismatch → 422, previous-failed/timeout → 409, missing key → 400) instead of 500.
- `locks`: `waitTimeout` now bounds the total time `acquire()` waits for a contended lock.
- `rate-limit`: token-bucket `peek()` / `getState()` now report the real bucket state (read via `HMGET` with refill) instead of placeholder values.
- `streams`: the `trim` config is now honored on publish, including keep-all (`trim.enabled: false`) for event sourcing; `consumer.claimIdleTimeout` now drives a background auto-claim of messages left pending by crashed/idle consumers; `producer.autoCreate: false` now sets `NOMKSTREAM`.
- `core`: synchronous `RedisModule.forRoot({ plugins: [...] })` now provides `REDIS_CLIENTS_INITIALIZATION`, so plugins resolve their Redis driver under sync `forRoot` (previously only `forRootAsync` worked).
- NestJS 11 build support across the monorepo; CI matrix extended to Node 22 and 24.
- `llms-full.txt`: a complete public-API method reference, with a CI check that fails if any exported service method is undocumented.

### Fixed

- `rate-limit`: the limit is consumed at most once per request even when the guard is bound more than once (`@RateLimit` on both class and method, or `@RateLimit` combined with a global `APP_GUARD`).
- `idempotency`: failed records now receive an explicit TTL instead of relying on the leftover lock expiry.
- `locks`: auto-renewal failures are now logged (and surfaced via `isAutoRenewing`) instead of being swallowed by an empty `catch`.
- `cache`: `TagInvalidationError` is preserved instead of being rewrapped as a generic `CacheError`, so it can be caught by type.
- Documentation aligned with actual library behavior (cache key charset, read/write fail policies, decorator key templates, and more).

## [1.2.0] - 2026-04-19

### Added
- Official Fastify adapter support in the `rate-limit` and `idempotency` plugins. Both adapters run through the same HTTP handling path and are covered by end-to-end tests.
- `apps/example`: Fastify bootstrap entry (`main.fastify.ts`), `start:fastify` script, and parallel `express.e2e-spec.ts` / `fastify.e2e-spec.ts` suites covering rate-limit headers and idempotent replay.
- `streams`: Consumer shutdown is now bounded by `shutdownTimeoutMs` (default `10000`). Handlers that exceed this window keep running in the background until their own logic completes or the Redis connection closes; the owning message remains in the stream's pending entries list and is redelivered to another consumer on restart. To match the previous unbounded behaviour, set `shutdownTimeoutMs: Infinity`.

### Fixed
- `idempotency`: request fingerprint on Fastify. The interceptor previously relied on Express-only `request.path`, which is `undefined` under Fastify and caused distinct requests to hash to the same fingerprint.
- `streams`: StreamsPlugin now shuts down gracefully on `app.close()` / `SIGTERM` via `OnApplicationShutdown`. Previously the consumer's blocking `XREADGROUP` call could keep the Node.js event loop alive after the application closed. Applications using `enableShutdownHooks()` (Kubernetes, systemd, Docker) no longer need `--forceExit` or `SIGKILL` to terminate.
- `tracing`: Bound the OpenTelemetry provider shutdown with a short timeout and swallow export failures. A dead / unreachable OTLP collector can no longer block or fail `app.close()`.

### Changed
- `rate-limit`: the guard and the 429 exception filter now write response headers and bodies through `HttpAdapterHost` from `@nestjs/core` instead of duck-typing the Express `response`. Behaviour on Express is byte-for-byte unchanged.
- `idempotency`: the interceptor now sets status / headers via `HttpAdapterHost` and derives the request path via `httpAdapter.getRequestUrl()`. Replay behaviour on Express is unchanged.

### Removed
- `metrics`: unused `@types/express` from `devDependencies`. The package never imported from Express.

### Compatibility
- No breaking changes. Public exports (`RateLimitGuard`, `RateLimitExceptionFilter`, `IdempotencyInterceptor`, `@RateLimit`, `@Idempotent`, `@IdempotencyKey`, `StreamsPlugin`, `@StreamConsumer`, injection tokens, error classes, plugin options) are identical to `1.1.2`. The new `shutdownTimeoutMs` streams option is optional with a safe default.
