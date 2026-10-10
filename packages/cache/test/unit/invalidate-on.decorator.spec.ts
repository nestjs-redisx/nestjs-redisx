import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { InvalidateOn, INVALIDATE_ON_OPTIONS, type IInvalidateOnOptions } from '../../src/invalidation/infrastructure/decorators/invalidate-on.decorator';

describe('@InvalidateOn decorator', () => {
  describe('metadata', () => {
    it('should preserve the method name and expose options metadata on the wrapper', () => {
      // Given
      const options: IInvalidateOnOptions = { events: ['user.updated'], tags: ['users'] };
      class UserService {
        @InvalidateOn({ events: ['user.updated'], tags: ['users'] })
        async update(): Promise<void> {
          /* noop */
        }
      }

      // Then
      const wrapper = UserService.prototype.update;
      expect(wrapper.name).toBe('update');
      expect(Reflect.getMetadata(INVALIDATE_ON_OPTIONS, wrapper)).toEqual(options);
    });
  });

  describe('metadata carry-over', () => {
    it('should carry metadata stamped by decorators applied before it - @Cron below @InvalidateOn must not silently unregister the job', () => {
      // Given - a method already stamped by an earlier decorator. Source order
      // `@InvalidateOn` above `@Cron()` applies @Cron FIRST, to the ORIGINAL
      // method; discovery-based consumers (the scheduler among them) read
      // metadata off the prototype's method - which is the wrapper after
      // @InvalidateOn runs.
      const CRON_METADATA = 'test:schedule-expression';
      class CarryOverHost {
        async job(): Promise<string> {
          return 'ran';
        }
      }
      const descriptor = Object.getOwnPropertyDescriptor(CarryOverHost.prototype, 'job')!;
      Reflect.defineMetadata(CRON_METADATA, '0 3 * * *', descriptor.value);

      // When - @InvalidateOn wraps the already-stamped method
      InvalidateOn({ events: ['order.paid'], tags: ['orders'] })(CarryOverHost.prototype, 'job', descriptor);
      Object.defineProperty(CarryOverHost.prototype, 'job', descriptor);

      // Then - the wrapper carries the earlier decorator's metadata (the cron
      // stays discoverable) and still exposes its own options
      const wrapper = CarryOverHost.prototype.job;
      expect(Reflect.getMetadata(CRON_METADATA, wrapper)).toBe('0 3 * * *');
      expect(Reflect.getMetadata(INVALIDATE_ON_OPTIONS, wrapper)).toEqual({ events: ['order.paid'], tags: ['orders'] });
    });
  });
});
