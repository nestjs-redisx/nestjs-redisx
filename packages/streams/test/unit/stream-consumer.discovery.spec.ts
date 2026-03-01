import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { StreamConsumerDiscovery } from '../../src/streams/api/discovery/stream-consumer.discovery';
import { StreamConsumer, STREAM_CONSUMER_METADATA } from '../../src/streams/api/decorators/stream-consumer.decorator';
import type { IStreamConsumer } from '../../src/streams/application/ports/stream-consumer.port';

function createMockDiscoveryService(providers: any[]) {
  return {
    getProviders: vi.fn().mockReturnValue(providers.map((instance) => ({ instance }))),
  };
}

function createMockConsumerService(): IStreamConsumer {
  return {
    createGroup: vi.fn().mockResolvedValue(undefined),
    consume: vi.fn().mockReturnValue({ id: 'handle-1', isRunning: true }),
    publish: vi.fn(),
    getInfo: vi.fn(),
    getPending: vi.fn(),
    ack: vi.fn(),
    claim: vi.fn(),
    trim: vi.fn(),
  } as unknown as IStreamConsumer;
}

describe('StreamConsumerDiscovery', () => {
  let reflector: Reflector;
  let mockConsumerService: IStreamConsumer;
  let mockModuleRef: any;

  beforeEach(() => {
    reflector = new Reflector();
    mockConsumerService = createMockConsumerService();
    mockModuleRef = {};
  });

  it('should not crash on providers with getter properties', async () => {
    // Given
    const getterSpy = vi.fn(() => {
      throw new Error('Getter should never be invoked');
    });

    class ProviderWithGetter {}
    Object.defineProperty(ProviderWithGetter.prototype, 'dangerousGetter', {
      get: getterSpy,
      enumerable: false,
      configurable: true,
    });

    const instance = new ProviderWithGetter();
    const discoveryService = createMockDiscoveryService([instance]);

    const discovery = new StreamConsumerDiscovery(discoveryService as any, mockConsumerService, reflector, mockModuleRef);

    // When / Then
    await expect(discovery.onModuleInit()).resolves.toBeUndefined();
    expect(getterSpy).not.toHaveBeenCalled();
  });

  it('should skip getter properties and only process regular methods', async () => {
    // Given
    const getterSpy = vi.fn(() => {
      throw new Error('Getter should never be invoked');
    });

    class ProviderWithMixedProps {
      @StreamConsumer({ stream: 'orders', group: 'processors' })
      handleOrder(data: any) {
        return data;
      }
    }

    Object.defineProperty(ProviderWithMixedProps.prototype, 'dangerousGetter', {
      get: getterSpy,
      enumerable: false,
      configurable: true,
    });

    const instance = new ProviderWithMixedProps();
    const discoveryService = createMockDiscoveryService([instance]);

    const discovery = new StreamConsumerDiscovery(discoveryService as any, mockConsumerService, reflector, mockModuleRef);

    // When
    await discovery.onModuleInit();

    // Then
    expect(getterSpy).not.toHaveBeenCalled();
    expect(mockConsumerService.createGroup).toHaveBeenCalledWith('orders', 'processors');
    expect(mockConsumerService.consume).toHaveBeenCalledWith('orders', 'processors', expect.any(String), expect.any(Function), expect.objectContaining({ stream: 'orders', group: 'processors' }));
  });

  it('should handle providers with only getters (no decorated methods)', async () => {
    // Given
    class ProviderWithOnlyGetters {}

    Object.defineProperty(ProviderWithOnlyGetters.prototype, 'getter1', {
      get: () => {
        throw new Error('Should not be called');
      },
      configurable: true,
    });
    Object.defineProperty(ProviderWithOnlyGetters.prototype, 'getter2', {
      get: () => {
        throw new Error('Should not be called');
      },
      configurable: true,
    });

    const instance = new ProviderWithOnlyGetters();
    const discoveryService = createMockDiscoveryService([instance]);

    const discovery = new StreamConsumerDiscovery(discoveryService as any, mockConsumerService, reflector, mockModuleRef);

    // When / Then
    await expect(discovery.onModuleInit()).resolves.toBeUndefined();
    expect(mockConsumerService.createGroup).not.toHaveBeenCalled();
    expect(mockConsumerService.consume).not.toHaveBeenCalled();
  });
});
