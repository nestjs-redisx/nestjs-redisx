---
title: Plugin System
description: Extensible plugin architecture with lifecycle hooks and dependency management
---

# Plugin System

Extend core functionality with self-contained plugins.

## Overview

The plugin system allows feature packages to register providers, exports, and controllers through a unified interface. Plugins are registered via `RedisModule.forRoot()` and managed by `PluginRegistryService`.

## IRedisXPlugin Interface

```typescript
interface IRedisXPlugin {
  /** Unique plugin identifier (lowercase, alphanumeric with hyphens) */
  readonly name: string;

  /** Plugin version following semver */
  readonly version: string;

  /** Optional human-readable description */
  readonly description?: string;

  /** Names of plugins this plugin depends on */
  readonly dependencies?: string[];

  /** Called when plugin is registered (sync setup) */
  onRegister?(context: IPluginContext): void | Promise<void>;

  /** Called after all plugins registered and Redis connected */
  onModuleInit?(context: IPluginContext): void | Promise<void>;

  /** Called on shutdown (cleanup, reverse dependency order) */
  onModuleDestroy?(context: IPluginContext): void | Promise<void>;

  /** Returns NestJS providers this plugin contributes */
  getProviders?(): Provider[];

  /** Returns exports that other modules can inject */
  getExports?(): Array<Provider | string | symbol | Type>;

  /** Returns NestJS controllers this plugin contributes */
  getControllers?(): Type[];
}
```

## Registering Plugins

### Synchronous

<<< @/apps/demo/src/core/plugin-system/with-plugins.setup.ts{typescript}

### Asynchronous

Plugins are provided **outside** `useFactory` — they must be available at module construction time:

<<< @/apps/demo/src/core/plugins-async.setup.ts{typescript}

## Lifecycle Hooks

Hooks are managed by `PluginRegistryService` and called in dependency order.

### Execution Order

```
1. onRegister()      — all plugins, in dependency order
2. onModuleInit()    — all plugins, in dependency order
3. (runtime)
4. onModuleDestroy() — all plugins, in REVERSE dependency order
```

All hooks are **optional**. Plugins without hooks are silently skipped.

### onRegister

Called immediately during module initialization. Use for synchronous setup.

```typescript
onRegister(context: IPluginContext): void {
  context.logger.info('Plugin registered');
}
```

### onModuleInit

Called after all plugins are registered. Use for async setup like loading Lua scripts.

```typescript
async onModuleInit(context: IPluginContext): Promise<void> {
  // Dependencies are guaranteed to be initialized
  const cachePlugin = context.getPlugin('cache');
  context.logger.info('Plugin initialized');
}
```

### onModuleDestroy

Called during shutdown in **reverse** dependency order. Dependencies are still alive when your plugin shuts down.

```typescript
async onModuleDestroy(context: IPluginContext): Promise<void> {
  // Flush buffers, close connections
  context.logger.info('Plugin destroyed');
}
```

## Plugin Dependencies

Declare dependencies with the `dependencies` array. The system uses topological sort (Kahn's algorithm) to determine initialization order.

<<< @/apps/demo/src/core/plugin-system/audit-plugin.usage.ts{typescript}

### Dependency Errors

**Missing dependency:**

```typescript
plugins: [new AuditPlugin()] // cache not registered!
// Throws: Plugin "audit" depends on "cache" which is not registered
```

**Circular dependency:**

```typescript
// A depends on B, B depends on A
// Throws: Circular dependency detected among plugins: audit, cache
```

## IPluginContext

Context provided to all lifecycle hooks.

```typescript
interface IPluginContext {
  /** Client manager for accessing and querying Redis clients */
  readonly clientManager: IClientManager;

  /** Module configuration (global settings, plugins list) */
  readonly config: IRedisXConfig;

  /** Scoped logger instance */
  readonly logger: IRedisXLogger;

  /** NestJS ModuleRef for advanced DI operations */
  readonly moduleRef: ModuleRef;

  /** Gets another plugin by name */
  getPlugin<T extends IRedisXPlugin>(name: string): T | undefined;

  /** Checks if a plugin is loaded */
  hasPlugin(name: string): boolean;
}

interface IClientManager {
  /** Gets Redis client by name (async) */
  getClient(name?: string): Promise<IRedisDriver>;

  /** Checks if client exists */
  hasClient(name: string): boolean;

  /** Gets all registered client names */
  getClientNames(): string[];
}
```

### Context Usage

<<< @/apps/demo/src/core/plugin-system/plugin-context.usage.ts{typescript}

## Creating a Plugin

### Minimal Plugin

<<< @/apps/demo/src/core/plugin-system/custom-plugin-minimal.usage.ts{typescript}

### Full Plugin with Lifecycle

<<< @/apps/demo/src/core/plugin-system/custom-plugin-full.usage.ts{typescript}

## Available Plugins

| Package | Plugin | Description |
|---------|--------|-------------|
| `@nestjs-redisx/cache` | `CachePlugin` | L1+L2 caching, SWR, tag invalidation |
| `@nestjs-redisx/locks` | `LocksPlugin` | Distributed locks with auto-renewal |
| `@nestjs-redisx/rate-limit` | `RateLimitPlugin` | Token bucket, sliding window, fixed window |
| `@nestjs-redisx/idempotency` | `IdempotencyPlugin` | Idempotent request handling |
| `@nestjs-redisx/streams` | `StreamsPlugin` | Redis Streams consumer/producer |
| `@nestjs-redisx/metrics` | `MetricsPlugin` | Prometheus metrics |
| `@nestjs-redisx/tracing` | `TracingPlugin` | OpenTelemetry tracing |

## PluginRegistryService

The internal service that manages plugin lifecycle. Exported for advanced use cases.

```typescript
import { PluginRegistryService, REGISTERED_PLUGINS } from '@nestjs-redisx/core';
```

| Token | Type | Description |
|-------|------|-------------|
| `REGISTERED_PLUGINS` | `IRedisXPlugin[]` | Array of all registered plugins |
| `PluginRegistryService` | `@Injectable()` | Manages lifecycle hooks and dependency ordering |

## Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Plugin class | `{Feature}Plugin` | `CachePlugin`, `LocksPlugin` |
| Service token | `{FEATURE}_SERVICE` | `LOCK_SERVICE`, `CACHE_SERVICE` |
| Options token | `{FEATURE}_PLUGIN_OPTIONS` | `LOCKS_PLUGIN_OPTIONS` |
| Store token | `{FEATURE}_STORE` | `LOCK_STORE` |

## Next Steps

- [Configuration](./configuration) — Module configuration with plugins
- [Error Handling](./error-handling) — Error system reference
- [Troubleshooting](./troubleshooting) — Common issues
