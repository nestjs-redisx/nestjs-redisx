/**
 * Event invalidation service.
 * Processes invalidation events and coordinates cache invalidation.
 */

import { createHash } from 'crypto';
import { EventEmitter } from 'events';

import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { REDIS_DRIVER, IRedisDriver } from '@nestjs-redisx/core';

import { ICacheService } from '../../../cache/application/ports/cache-service.port';
import { CACHE_PLUGIN_OPTIONS, CACHE_SERVICE, INVALIDATION_REGISTRY } from '../../../shared/constants';
import { ICachePluginOptions } from '../../../shared/types';
import { IEventInvalidationService, InvalidationHandler, IInvalidationResult } from '../ports/event-invalidation.port';
import { IInvalidationRegistry } from '../ports/invalidation-registry.port';

@Injectable()
export class EventInvalidationService implements IEventInvalidationService, OnModuleInit {
  private readonly logger = new Logger(EventInvalidationService.name);
  private readonly handlers = new Set<InvalidationHandler>();
  private readonly eventEmitter = new EventEmitter();

  constructor(
    @Inject(INVALIDATION_REGISTRY)
    private readonly registry: IInvalidationRegistry,
    @Inject(CACHE_SERVICE) private readonly cacheService: ICacheService,
    @Inject(REDIS_DRIVER) private readonly driver: IRedisDriver,
    @Inject(CACHE_PLUGIN_OPTIONS) private readonly config: ICachePluginOptions,
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async onModuleInit(): Promise<void> {
    // Setup event source based on config
    const source = this.config.invalidation?.source ?? 'internal';

    if (source === 'internal') {
      this.setupInternalSource();
      this.logger.log('Event invalidation initialized with internal source');
    }
    // AMQP source is setup via AMQPEventSourceAdapter
  }

  async processEvent(event: string, payload: unknown): Promise<IInvalidationResult> {
    const startTime = Date.now();

    try {
      // Deduplication check
      const eventId = this.generateEventId(event, payload);
      const isDuplicate = await this.checkDuplicate(eventId);

      if (isDuplicate) {
        this.logger.debug(`Skipping duplicate event "${event}"`);
        return {
          event,
          tagsInvalidated: [],
          keysInvalidated: [],
          totalKeysDeleted: 0,
          duration: Date.now() - startTime,
          skipped: true,
          skipReason: 'duplicate',
        };
      }

      // Resolve what to invalidate
      const resolved = this.registry.resolve(event, payload);

      if (resolved.tags.length === 0 && resolved.keys.length === 0) {
        this.logger.debug(`No matching rules for event "${event}"`);
        return {
          event,
          tagsInvalidated: [],
          keysInvalidated: [],
          totalKeysDeleted: 0,
          duration: Date.now() - startTime,
          skipped: true,
          skipReason: 'no_matching_rules',
        };
      }

      // Perform invalidation
      let totalDeleted = 0;

      if (resolved.tags.length > 0) {
        this.logger.debug(`Invalidating tags: ${resolved.tags.join(', ')} for event "${event}"`);
        totalDeleted += await this.cacheService.invalidateTags(resolved.tags);
      }

      if (resolved.keys.length > 0) {
        this.logger.debug(`Invalidating keys: ${resolved.keys.join(', ')} for event "${event}"`);
        totalDeleted += await this.cacheService.deleteMany(resolved.keys);
      }

      // Mark as processed
      await this.markProcessed(eventId);

      const result: IInvalidationResult = {
        event,
        tagsInvalidated: resolved.tags,
        keysInvalidated: resolved.keys,
        totalKeysDeleted: totalDeleted,
        duration: Date.now() - startTime,
        skipped: false,
      };

      this.logger.log(`Processed event "${event}": invalidated ${resolved.tags.length} tags, ${resolved.keys.length} keys, deleted ${totalDeleted} cache entries (${result.duration}ms)`);

      // Notify handlers
      await this.notifyHandlers(event, payload, result);

      return result;
    } catch (error) {
      this.logger.error(`Failed to process event "${event}":`, error);
      throw error;
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async emit(event: string, payload: unknown): Promise<void> {
    this.eventEmitter.emit('invalidation', { event, payload });
  }

  subscribe(handler: InvalidationHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private setupInternalSource(): void {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.eventEmitter.on('invalidation', async ({ event, payload }) => {
      try {
        await this.processEvent(event, payload);
      } catch (error) {
        this.logger.error(`Internal event processing failed for "${event}":`, error);
      }
    });
  }

  private async checkDuplicate(eventId: string): Promise<boolean> {
    try {
      const key = `_invalidation:processed:${eventId}`;
      const exists = await this.driver.exists(key);
      return exists > 0;
    } catch (error) {
      this.logger.warn('Deduplication check failed:', error);
      return false; // Fail-open
    }
  }

  private async markProcessed(eventId: string): Promise<void> {
    try {
      const key = `_invalidation:processed:${eventId}`;
      const ttl = this.config.invalidation?.deduplicationTtl ?? 60;
      await this.driver.setex(key, ttl, '1');
    } catch (error) {
      this.logger.warn('Failed to mark event as processed:', error);
      // Don't throw - this is not critical
    }
  }

  private generateEventId(event: string, payload: unknown): string {
    const hash = createHash('sha256')
      .update(event)
      .update(JSON.stringify(payload ?? {}))
      .digest('hex')
      .slice(0, 16);
    return hash;
  }

  private async notifyHandlers(event: string, payload: unknown, result: IInvalidationResult): Promise<void> {
    for (const handler of this.handlers) {
      try {
        await handler(event, payload, result);
      } catch (error) {
        this.logger.error('Invalidation handler error:', error);
        // Don't propagate handler errors
      }
    }
  }
}
