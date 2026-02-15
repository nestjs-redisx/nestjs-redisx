import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { StreamConsumer, STREAM_CONSUMER_METADATA } from '../../src/streams/api/decorators/stream-consumer.decorator';
import type { StreamConsumerOptions } from '../../src/shared/types';

describe('@StreamConsumer Decorator', () => {
  const reflector = new Reflector();

  it('should set consumer metadata with options', () => {
    // Given
    const options: IStreamConsumerOptions = {
      stream: 'orders',
      group: 'processors',
    };

    class TestConsumer {
      @StreamConsumer(options)
      handleMessage(data: any) {
        return data;
      }
    }

    // When
    const metadata = reflector.get(STREAM_CONSUMER_METADATA, TestConsumer.prototype.handleMessage);

    // Then
    expect(metadata).toMatchObject({
      stream: 'orders',
      group: 'processors',
      methodName: 'handleMessage',
    });
  });

  it('should set metadata with all consumer options', () => {
    // Given
    const options: IStreamConsumerOptions = {
      stream: 'events',
      group: 'workers',
      consumer: 'worker-1',
      batchSize: 20,
      blockTimeout: 10000,
      concurrency: 5,
    };

    class TestConsumer {
      @StreamConsumer(options)
      processEvent(data: any) {
        return data;
      }
    }

    // When
    const metadata = reflector.get(STREAM_CONSUMER_METADATA, TestConsumer.prototype.processEvent);

    // Then
    expect(metadata).toMatchObject({
      stream: 'events',
      group: 'workers',
      consumer: 'worker-1',
      batchSize: 20,
      blockTimeout: 10000,
      concurrency: 5,
      methodName: 'processEvent',
    });
  });

  it('should set metadata on multiple methods', () => {
    // Given
    class TestConsumer {
      @StreamConsumer({ stream: 'orders', group: 'processors' })
      handleOrder(data: any) {
        return data;
      }

      @StreamConsumer({ stream: 'events', group: 'listeners' })
      handleEvent(data: any) {
        return data;
      }
    }

    // When
    const orderMetadata = reflector.get(STREAM_CONSUMER_METADATA, TestConsumer.prototype.handleOrder);
    const eventMetadata = reflector.get(STREAM_CONSUMER_METADATA, TestConsumer.prototype.handleEvent);

    // Then
    expect(orderMetadata).toMatchObject({
      stream: 'orders',
      group: 'processors',
      methodName: 'handleOrder',
    });
    expect(eventMetadata).toMatchObject({
      stream: 'events',
      group: 'listeners',
      methodName: 'handleEvent',
    });
  });

  it('should preserve method descriptor', () => {
    // Given/When
    class TestConsumer {
      @StreamConsumer({ stream: 'test', group: 'group' })
      handleMessage(data: any) {
        return `processed: ${data}`;
      }
    }

    const instance = new TestConsumer();
    const result = instance.handleMessage('test');

    // Then
    expect(result).toBe('processed: test');
  });
});
