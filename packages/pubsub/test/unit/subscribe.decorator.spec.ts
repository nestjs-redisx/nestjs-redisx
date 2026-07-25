import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { Subscribe, PUBSUB_SUBSCRIBE_METADATA } from '../../src/pubsub/api/decorators/subscribe.decorator';
import { PubSubDiscovery } from '../../src/pubsub/api/discovery/pubsub.discovery';
import type { IPubSubService } from '../../src/pubsub/application/ports/pubsub-service.port';

describe('Subscribe decorator', () => {
  it('should attach channel metadata from the string form', () => {
    // Given
    class Handler {
      @Subscribe('user.created')
      onCreated(): void {}
    }

    // When
    const metadata = new Reflector().get(PUBSUB_SUBSCRIBE_METADATA, Handler.prototype.onCreated);

    // Then
    expect(metadata).toEqual({ channel: 'user.created' });
  });

  it('should attach pattern metadata from the options form', () => {
    // Given
    class Handler {
      @Subscribe({ pattern: 'user.*' })
      onAny(): void {}
    }

    // When
    const metadata = new Reflector().get(PUBSUB_SUBSCRIBE_METADATA, Handler.prototype.onAny);

    // Then
    expect(metadata).toEqual({ pattern: 'user.*' });
  });

  it('should reject empty options and channel+pattern combinations', () => {
    // When / Then
    expect(() => Subscribe({})).toThrow('@Subscribe requires a channel name or a { pattern } option');
    expect(() => Subscribe({ channel: 'a', pattern: 'b' })).toThrow('@Subscribe accepts either a channel or a pattern, not both');
  });
});

describe('PubSubDiscovery', () => {
  let service: { subscribe: ReturnType<typeof vi.fn>; psubscribe: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    service = { subscribe: vi.fn().mockResolvedValue({}), psubscribe: vi.fn().mockResolvedValue({}) };
  });

  function discoveryFor(instances: object[]): PubSubDiscovery {
    const discoveryService = { getProviders: () => instances.map((instance) => ({ instance })) };
    return new PubSubDiscovery(discoveryService as never, service as unknown as IPubSubService, new Reflector());
  }

  it('should register decorated channel and pattern handlers bound to their instance', async () => {
    // Given
    const seen: string[] = [];
    class Handlers {
      prefix = 'H:';
      @Subscribe('user.created')
      onCreated(msg: { data: string }): void {
        seen.push(this.prefix + msg.data);
      }
      @Subscribe({ pattern: 'order.*' })
      onOrder(): void {}
      notDecorated(): void {}
    }
    const instance = new Handlers();

    // When
    await discoveryFor([instance]).onModuleInit();

    // Then — both registered, non-decorated ignored
    expect(service.subscribe).toHaveBeenCalledTimes(1);
    expect(service.subscribe).toHaveBeenCalledWith('user.created', expect.any(Function));
    expect(service.psubscribe).toHaveBeenCalledWith('order.*', expect.any(Function));

    // And the handler is BOUND to the instance
    const handler = service.subscribe.mock.calls[0][1] as (msg: unknown) => void;
    handler({ data: 'x' });
    expect(seen).toEqual(['H:x']);
  });

  it('should skip providers without instances and warn when DiscoveryService is absent', async () => {
    // Given — no DiscoveryService at all
    const discovery = new PubSubDiscovery(null, service as unknown as IPubSubService, new Reflector());

    // When / Then — no throw, nothing registered
    await discovery.onModuleInit();
    expect(service.subscribe).not.toHaveBeenCalled();

    // And null instances are skipped
    const withEmpty = new PubSubDiscovery({ getProviders: () => [{ instance: null }] } as never, service as unknown as IPubSubService, new Reflector());
    await withEmpty.onModuleInit();
    expect(service.subscribe).not.toHaveBeenCalled();
  });
});
