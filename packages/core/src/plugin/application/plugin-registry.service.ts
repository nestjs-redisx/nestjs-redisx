import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { RedisClientManager } from '../../client';
import { CLIENT_MANAGER, REDIS_MODULE_OPTIONS, REGISTERED_PLUGINS } from '../../shared/constants';
import { RedisXError, ErrorCode } from '../../errors';
import { IRedisModuleOptions } from '../../types';
import { IRedisXPlugin, IPluginContext, IClientManager, IRedisXConfig, IRedisXLogger } from '../domain/interfaces';

/**
 * Manages plugin lifecycle hooks and dependency ordering.
 *
 * Calls `onRegister()` and `onModuleInit()` on all plugins during
 * NestJS module initialization, and `onModuleDestroy()` during shutdown.
 * Plugins with `dependencies` are initialized in topological order.
 */
@Injectable()
export class PluginRegistryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PluginRegistryService.name);

  constructor(
    @Inject(REGISTERED_PLUGINS) private readonly plugins: IRedisXPlugin[],
    @Inject(CLIENT_MANAGER) private readonly clientManager: RedisClientManager,
    @Inject(REDIS_MODULE_OPTIONS) private readonly options: IRedisModuleOptions,
    private readonly moduleRef: ModuleRef,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.plugins.length === 0) {
      return;
    }

    const sorted = this.sortByDependencies(this.plugins);
    const context = this.createContext();

    for (const plugin of sorted) {
      if (plugin.onRegister) {
        this.logger.debug(`Calling onRegister for plugin "${plugin.name}"`);
        await plugin.onRegister(context);
      }
    }

    for (const plugin of sorted) {
      if (plugin.onModuleInit) {
        this.logger.debug(`Calling onModuleInit for plugin "${plugin.name}"`);
        await plugin.onModuleInit(context);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.plugins.length === 0) {
      return;
    }

    const sorted = this.sortByDependencies(this.plugins).reverse();
    const context = this.createContext();

    for (const plugin of sorted) {
      if (plugin.onModuleDestroy) {
        this.logger.debug(`Calling onModuleDestroy for plugin "${plugin.name}"`);
        await plugin.onModuleDestroy(context);
      }
    }
  }

  private createContext(): IPluginContext {
    const plugins = this.plugins;
    const clientManager = this.clientManager;
    const moduleRef = this.moduleRef;

    const pluginClientManager: IClientManager = {
      getClient(name?: string) {
        return clientManager.getClient(name);
      },
      hasClient(name: string): boolean {
        return clientManager.hasClient(name);
      },
      getClientNames(): string[] {
        return clientManager.getClientNames();
      },
    };

    const pluginLogger: IRedisXLogger = {
      debug: (message: string, context?: Record<string, unknown>) => {
        this.logger.debug(message, context ? JSON.stringify(context) : undefined);
      },
      info: (message: string, context?: Record<string, unknown>) => {
        this.logger.log(message, context ? JSON.stringify(context) : undefined);
      },
      warn: (message: string, context?: Record<string, unknown>) => {
        this.logger.warn(message, context ? JSON.stringify(context) : undefined);
      },
      error: (message: string, error?: Error, context?: Record<string, unknown>) => {
        this.logger.error(message, error?.stack, context ? JSON.stringify(context) : undefined);
      },
    };

    const pluginConfig: IRedisXConfig = {
      clients: {},
      plugins,
      global: {
        debug: this.options.global?.debug,
        defaultTtl: this.options.global?.defaultTtl,
        keyPrefix: this.options.global?.keyPrefix,
      },
    };

    return {
      clientManager: pluginClientManager,
      config: pluginConfig,
      logger: pluginLogger,
      moduleRef,
      getPlugin: <T extends IRedisXPlugin>(name: string): T | undefined => {
        return plugins.find((p) => p.name === name) as T | undefined;
      },
      hasPlugin: (name: string): boolean => {
        return plugins.some((p) => p.name === name);
      },
    };
  }

  /**
   * Topological sort of plugins by dependencies (Kahn's algorithm).
   * Plugins without dependencies maintain their original order.
   * Throws on circular dependencies.
   */
  sortByDependencies(plugins: IRedisXPlugin[]): IRedisXPlugin[] {
    if (plugins.length === 0) {
      return [];
    }

    const pluginMap = new Map<string, IRedisXPlugin>();
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const plugin of plugins) {
      pluginMap.set(plugin.name, plugin);
      inDegree.set(plugin.name, 0);
      adjacency.set(plugin.name, []);
    }

    // Build the graph: if A depends on B, edge B -> A (B must come before A)
    for (const plugin of plugins) {
      const deps = plugin.dependencies || [];
      for (const dep of deps) {
        if (!pluginMap.has(dep)) {
          throw new RedisXError(`Plugin "${plugin.name}" depends on "${dep}" which is not registered`, ErrorCode.PLUGIN_DEPENDENCY_MISSING, undefined, { plugin: plugin.name, missingDependency: dep });
        }
        adjacency.get(dep)!.push(plugin.name);
        inDegree.set(plugin.name, (inDegree.get(plugin.name) || 0) + 1);
      }
    }

    // Kahn's algorithm — use original order for plugins with same in-degree
    const originalIndex = new Map<string, number>();
    plugins.forEach((p, i) => originalIndex.set(p.name, i));

    const queue: string[] = [];
    for (const plugin of plugins) {
      if (inDegree.get(plugin.name) === 0) {
        queue.push(plugin.name);
      }
    }
    // Sort the initial queue by original order
    queue.sort((a, b) => originalIndex.get(a)! - originalIndex.get(b)!);

    const sorted: IRedisXPlugin[] = [];

    while (queue.length > 0) {
      const name = queue.shift()!;
      sorted.push(pluginMap.get(name)!);

      const neighbors = adjacency.get(name) || [];
      const newReady: string[] = [];
      for (const neighbor of neighbors) {
        const deg = inDegree.get(neighbor)! - 1;
        inDegree.set(neighbor, deg);
        if (deg === 0) {
          newReady.push(neighbor);
        }
      }
      // Sort newly ready by original order
      newReady.sort((a, b) => originalIndex.get(a)! - originalIndex.get(b)!);
      queue.push(...newReady);
    }

    if (sorted.length !== plugins.length) {
      const remaining = plugins.filter((p) => !sorted.some((s) => s.name === p.name)).map((p) => p.name);
      throw new RedisXError(`Circular dependency detected among plugins: ${remaining.join(', ')}`, ErrorCode.PLUGIN_CIRCULAR_DEPENDENCY, undefined, { circularPlugins: remaining });
    }

    return sorted;
  }
}
