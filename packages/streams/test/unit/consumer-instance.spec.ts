import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConsumerInstance, type IConsumerInstanceConfig } from '../../src/streams/application/services/consumer-instance';

function createMockDriver() {
  return {
    xgroupCreate: vi.fn().mockResolvedValue('OK'),
    xreadgroup: vi.fn().mockResolvedValue(null),
    xack: vi.fn().mockResolvedValue(1),
    xadd: vi.fn().mockResolvedValue('1234567890-0'),
  } as any;
}

function createMockDlqService() {
  return {
    add: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockResolvedValue([]),
    requeue: vi.fn().mockResolvedValue(undefined),
    purge: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function createMockMetrics() {
  return {
    incrementCounter: vi.fn(),
    observeHistogram: vi.fn(),
    setGauge: vi.fn(),
  };
}

function createConfig<T>(overrides: Partial<IConsumerInstanceConfig<T>> = {}): IConsumerInstanceConfig<T> {
  return {
    stream: 'test-stream',
    group: 'test-group',
    consumer: 'test-consumer',
    handler: vi.fn().mockResolvedValue(undefined),
    batchSize: 10,
    blockTimeout: 2000,
    maxRetries: 3,
    concurrency: 5,
    startId: '>',
    retryInitialDelay: 100,
    retryMaxDelay: 5000,
    retryMultiplier: 2,
    ...overrides,
  };
}

describe('ConsumerInstance', () => {
  let driver: ReturnType<typeof createMockDriver>;
  let dlqService: ReturnType<typeof createMockDlqService>;
  let metrics: ReturnType<typeof createMockMetrics>;
  let config: IConsumerInstanceConfig<any>;

  beforeEach(() => {
    vi.useFakeTimers();
    driver = createMockDriver();
    dlqService = createMockDlqService();
    metrics = createMockMetrics();
    config = createConfig();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('ensureGroup', () => {
    it('should create consumer group', async () => {
      // Given
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);

      // When
      await (instance as any).ensureGroup();

      // Then
      expect(driver.xgroupCreate).toHaveBeenCalledWith('test-stream', 'test-group', '$', true);
    });

    it('should use 0 as start ID when startId is not >', async () => {
      // Given
      config.startId = '0';
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);

      // When
      await (instance as any).ensureGroup();

      // Then
      expect(driver.xgroupCreate).toHaveBeenCalledWith('test-stream', 'test-group', '0', true);
    });

    it('should ignore BUSYGROUP error', async () => {
      // Given
      driver.xgroupCreate.mockRejectedValue(new Error('BUSYGROUP Consumer Group name already exists'));
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);

      // When/Then — should not throw
      await expect((instance as any).ensureGroup()).resolves.toBeUndefined();
    });

    it('should rethrow non-BUSYGROUP errors', async () => {
      // Given
      driver.xgroupCreate.mockRejectedValue(new Error('Connection refused'));
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);

      // When/Then
      await expect((instance as any).ensureGroup()).rejects.toThrow('Connection refused');
    });
  });

  describe('ack', () => {
    it('should acknowledge message', async () => {
      // Given
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);

      // When
      await (instance as any).ack('1234567890-0');

      // Then
      expect(driver.xack).toHaveBeenCalledWith('test-stream', 'test-group', '1234567890-0');
    });
  });

  describe('processMessage', () => {
    it('should parse data, call handler, ack, and record metrics', async () => {
      // Given
      const handler = vi.fn().mockResolvedValue(undefined);
      config.handler = handler;
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);

      const fields = { data: JSON.stringify({ orderId: 1 }), _attempt: '1' };

      // When
      await (instance as any).processMessage('1700000000000-0', fields);

      // Then
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '1700000000000-0',
          stream: 'test-stream',
          data: { orderId: 1 },
          attempt: 1,
        }),
      );
      expect(driver.xack).toHaveBeenCalledWith('test-stream', 'test-group', '1700000000000-0');
      expect(metrics.incrementCounter).toHaveBeenCalledWith('redisx_stream_messages_consumed_total', expect.objectContaining({ status: 'success' }));
      expect(metrics.observeHistogram).toHaveBeenCalled();
    });

    it('should default attempt to 1 when _attempt not in fields', async () => {
      // Given
      const handler = vi.fn().mockResolvedValue(undefined);
      config.handler = handler;
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);

      // When
      await (instance as any).processMessage('1700000000000-0', { data: JSON.stringify('test') });

      // Then
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1 }));
    });

    it('should call handleFailure on handler error', async () => {
      // Given
      const handler = vi.fn().mockRejectedValue(new Error('handler-fail'));
      config.handler = handler;
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);
      // Simulate a running consumer so processMessage does not treat a handler
      // error as a shutdown-path short-circuit.
      (instance as any).running = true;
      const spy = vi.spyOn(instance as any, 'handleFailure').mockResolvedValue(undefined);

      // When
      await (instance as any).processMessage('1700000000000-0', { data: JSON.stringify({ x: 1 }), _attempt: '2' });

      // Then
      expect(spy).toHaveBeenCalledWith('1700000000000-0', { x: 1 }, 2, expect.any(Error));
      expect(metrics.incrementCounter).toHaveBeenCalledWith('redisx_stream_messages_consumed_total', expect.objectContaining({ status: 'error' }));
    });

    it('should skip handleFailure during shutdown (running=false)', async () => {
      // Given a consumer that is not running (post-shutdown) and a handler that rejects
      const handler = vi.fn().mockRejectedValue(new Error('handler-fail'));
      config.handler = handler;
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);
      const spy = vi.spyOn(instance as any, 'handleFailure');

      // When
      await (instance as any).processMessage('1700000000000-0', { data: JSON.stringify({ x: 1 }) });

      // Then — the failure path is skipped so no retry / DLQ work hits a torn-down driver
      expect(spy).not.toHaveBeenCalled();
    });

    it('should work without metrics (metrics undefined)', async () => {
      // Given
      const handler = vi.fn().mockResolvedValue(undefined);
      config.handler = handler;
      const instance = new ConsumerInstance(driver, dlqService, config);

      // When/Then — should not throw
      await expect((instance as any).processMessage('1700000000000-0', { data: JSON.stringify('ok') })).resolves.toBeUndefined();
    });

    it('should decrement processing counter in finally', async () => {
      // Given
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);

      // When
      await (instance as any).processMessage('1700000000000-0', { data: JSON.stringify('ok') });

      // Then
      expect((instance as any).processing).toBe(0);
    });
  });

  describe('handleFailure', () => {
    it('should send to DLQ when attempt >= maxRetries', async () => {
      // Given
      config.maxRetries = 3;
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);
      const error = new Error('fail');

      // When
      await (instance as any).handleFailure('id-1', { data: 'test' }, 3, error);

      // Then
      expect(dlqService.add).toHaveBeenCalledWith('test-stream', 'id-1', { data: 'test' }, error);
      expect(driver.xack).toHaveBeenCalledWith('test-stream', 'test-group', 'id-1');
      expect(metrics.incrementCounter).toHaveBeenCalledWith('redisx_stream_messages_consumed_total', expect.objectContaining({ status: 'dead_letter' }));
    });

    it('should retry with exponential backoff when attempt < maxRetries', async () => {
      // Given
      config.maxRetries = 3;
      config.retryInitialDelay = 100;
      config.retryMultiplier = 2;
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);

      // When
      const promise = (instance as any).handleFailure('id-1', { x: 1 }, 1);
      await vi.advanceTimersByTimeAsync(100); // delay = min(100 * 2^0, 5000) = 100
      await promise;

      // Then
      expect(driver.xadd).toHaveBeenCalledWith('test-stream', '*', {
        data: JSON.stringify({ x: 1 }),
        _attempt: '2',
      });
      expect(driver.xack).toHaveBeenCalledWith('test-stream', 'test-group', 'id-1');
      expect(metrics.incrementCounter).toHaveBeenCalledWith('redisx_stream_messages_consumed_total', expect.objectContaining({ status: 'retry' }));
    });

    it('should cap retry delay at retryMaxDelay', async () => {
      // Given
      config.maxRetries = 10;
      config.retryInitialDelay = 1000;
      config.retryMultiplier = 10;
      config.retryMaxDelay = 5000;
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);

      // When — attempt 5: delay = min(1000 * 10^4, 5000) = 5000
      const promise = (instance as any).handleFailure('id-1', 'data', 5);
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      // Then
      expect(driver.xadd).toHaveBeenCalled();
    });

    it('should work without metrics in DLQ path', async () => {
      // Given
      config.maxRetries = 1;
      const instance = new ConsumerInstance(driver, dlqService, config);

      // When/Then — should not throw
      await expect((instance as any).handleFailure('id-1', 'data', 1)).resolves.toBeUndefined();
      expect(dlqService.add).toHaveBeenCalled();
    });

    it('should work without metrics in retry path', async () => {
      // Given
      config.maxRetries = 3;
      const instance = new ConsumerInstance(driver, dlqService, config);

      // When
      const promise = (instance as any).handleFailure('id-1', 'data', 1);
      await vi.advanceTimersByTimeAsync(100);
      await promise;

      // Then
      expect(driver.xadd).toHaveBeenCalled();
    });
  });

  describe('poll', () => {
    it('should process messages from xreadgroup', async () => {
      // Given
      const handler = vi.fn().mockResolvedValue(undefined);
      config.handler = handler;
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);

      driver.xreadgroup.mockImplementation(async () => {
        // Stop after first poll
        (instance as any).running = false;
        return [
          {
            name: 'test-stream',
            entries: [{ id: '1700000000000-0', fields: { data: JSON.stringify({ x: 1 }) } }],
          },
        ];
      });

      // When
      (instance as any).running = true;
      await (instance as any).poll();

      // Then
      expect(driver.xreadgroup).toHaveBeenCalled();
    });

    it('should handle null result from xreadgroup', async () => {
      // Given
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);
      let callCount = 0;

      driver.xreadgroup.mockImplementation(async () => {
        callCount++;
        if (callCount >= 2) {
          (instance as any).running = false;
        }
        return null;
      });

      // When
      (instance as any).running = true;
      await (instance as any).poll();

      // Then
      expect(callCount).toBeGreaterThanOrEqual(2);
    });

    it('should retry on error with delay', async () => {
      // Given
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);
      let callCount = 0;

      driver.xreadgroup.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Connection lost');
        }
        (instance as any).running = false;
        return null;
      });

      // When
      (instance as any).running = true;
      const pollPromise = (instance as any).poll();
      await vi.advanceTimersByTimeAsync(1000); // ERROR_RETRY_DELAY_MS
      await pollPromise;

      // Then
      expect(callCount).toBe(2);
    });
  });

  describe('start and stop', () => {
    it('should call ensureGroup and start polling on start', async () => {
      // Given
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);

      // When
      await instance.start();

      // Then
      expect(driver.xgroupCreate).toHaveBeenCalled();
      expect((instance as any).running).toBe(true);

      // Cleanup — stop the poll loop
      await instance.stop();
    });

    it('should set running to false on stop', async () => {
      // Given
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);

      // When
      await instance.stop();

      // Then
      expect((instance as any).running).toBe(false);
    });

    it('should wait for in-flight processing to complete on stop', async () => {
      // Given
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);
      (instance as any).processing = 1;

      // When
      const stopPromise = instance.stop();

      // Simulate processing completing after a short delay
      await vi.advanceTimersByTimeAsync(100);
      (instance as any).processing = 0;
      await vi.advanceTimersByTimeAsync(100);
      await stopPromise;

      // Then
      expect((instance as any).running).toBe(false);
    });

    it('should be a no-op when stop() is called before start()', async () => {
      // Given — a consumer that has never been started
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);

      // When
      await expect(instance.stop()).resolves.toBeUndefined();

      // Then — no group created, no polling, nothing to tear down
      expect((instance as any).running).toBe(false);
      expect((instance as any).pollPromise).toBeUndefined();
      expect(driver.xgroupCreate).not.toHaveBeenCalled();
    });

    it('should be idempotent when stop() is called twice after start()', async () => {
      // Given
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);
      await instance.start();

      // When
      await instance.stop();
      const secondStop = instance.stop();

      // Then — the second stop returns immediately because running=false and
      // pollPromise has already been cleared by the first stop.
      await expect(secondStop).resolves.toBeUndefined();
      expect((instance as any).running).toBe(false);
      expect((instance as any).pollPromise).toBeUndefined();
    });
  });

  describe('shutdown error detection', () => {
    const SHUTDOWN_HINTS = ['Connection is closed', 'Connection closed', 'Client is closed', 'The client is closed', 'Driver is not connected', 'DRIVER_NOT_CONNECTED', 'ECONNRESET', 'ECONNREFUSED'];

    it.each(SHUTDOWN_HINTS)('should short-circuit processMessage when handler throws error containing "%s"', async (hint) => {
      // Given a handler that rejects with a shutdown-style teardown error
      const handler = vi.fn().mockRejectedValue(new Error(`redis client error: ${hint} during teardown`));
      config.handler = handler;
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);
      (instance as any).running = true;
      const spy = vi.spyOn(instance as any, 'handleFailure');

      // When
      await (instance as any).processMessage('1700000000000-0', { data: JSON.stringify({ x: 1 }) });

      // Then — no retry / DLQ work kicked off, because the driver is tearing down
      expect(spy).not.toHaveBeenCalled();
    });

    it('should fall through to handleFailure for unrelated errors', async () => {
      // Given
      const handler = vi.fn().mockRejectedValue(new Error('Foo bar baz'));
      config.handler = handler;
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);
      (instance as any).running = true;
      const spy = vi.spyOn(instance as any, 'handleFailure').mockResolvedValue(undefined);

      // When
      await (instance as any).processMessage('1700000000000-0', { data: JSON.stringify({ x: 1 }), _attempt: '1' });

      // Then — a plain error is not a shutdown signal, so handleFailure runs
      expect(spy).toHaveBeenCalledWith('1700000000000-0', { x: 1 }, 1, expect.any(Error));
    });

    it.each(SHUTDOWN_HINTS)('should break poll loop without retry delay when xreadgroup rejects with "%s"', async (hint) => {
      // Given
      const instance = new ConsumerInstance(driver, dlqService, config, metrics);
      driver.xreadgroup.mockRejectedValueOnce(new Error(`xreadgroup failed: ${hint}`));
      (instance as any).running = true;
      (instance as any).shutdownSignal = new Promise(() => {
        // never resolves — forces the loop to terminate via the shutdown-hint path
      });

      // When
      await (instance as any).poll();

      // Then — only the single rejecting call happened; no 1s retry delay was taken
      expect(driver.xreadgroup).toHaveBeenCalledTimes(1);
    });
  });
});
