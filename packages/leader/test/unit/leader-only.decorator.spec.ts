import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'reflect-metadata';
import { LeaderOnly, LEADER_ONLY_OPTIONS, registerLeaderServiceGetter, registerLeaderGroup, getRegisteredLeaderGroups, clearRegisteredLeaderGroups } from '../../src/leader/api/decorators/leader-only.decorator';
import { LeaderDecoratorInitializerService } from '../../src/leader/application/services/leader-decorator-initializer.service';
import { InvalidLeaderConfigError } from '../../src/shared/errors';

describe('@LeaderOnly decorator', () => {
  beforeEach(() => {
    clearRegisteredLeaderGroups();
    registerLeaderServiceGetter(null);
  });

  describe('group registry (decoration time)', () => {
    it('should register the default group when no group is given', () => {
      // When
      class Jobs {
        @LeaderOnly()
        async run(): Promise<string> {
          return 'ran';
        }
      }
      void Jobs;

      // Then
      expect(getRegisteredLeaderGroups().has('default')).toBe(true);
    });

    it('should register a custom group at decoration time (before any instance exists)', () => {
      // When
      class Jobs {
        @LeaderOnly({ group: 'reports' })
        async run(): Promise<string> {
          return 'ran';
        }
      }
      void Jobs;

      // Then
      expect(getRegisteredLeaderGroups().has('reports')).toBe(true);
    });

    it('should support manual registration too', () => {
      // When
      registerLeaderGroup('manual');

      // Then
      expect(getRegisteredLeaderGroups().has('manual')).toBe(true);
    });

    it('should fail fast at decoration time on an invalid group', () => {
      // When/Then — the error surfaces at class load, not silently at runtime
      expect(() => {
        class Jobs {
          @LeaderOnly({ group: '   ' })
          async run(): Promise<void> {
            /* noop */
          }
        }
        void Jobs;
      }).toThrow(InvalidLeaderConfigError);
    });

    it('should fail fast at decoration time when applied to a non-method member', () => {
      // When/Then — a getter has no method to gate; a cryptic TypeError (or a
      // silent skip that runs the body everywhere) would hide the mistake
      expect(() => {
        class Jobs {
          @LeaderOnly()
          get report(): string {
            return 'value';
          }
        }
        void Jobs;
      }).toThrow(InvalidLeaderConfigError);
    });
  });

  describe('execution gating', () => {
    it('should SKIP the method when no leader service is available (fail-safe: better nobody than everybody)', async () => {
      // Given
      const body = vi.fn().mockResolvedValue('ran');
      class Jobs {
        @LeaderOnly()
        async run(): Promise<string> {
          return body();
        }
      }

      // When
      const result = await new Jobs().run();

      // Then
      expect(result).toBeUndefined();
      expect(body).not.toHaveBeenCalled();
    });

    it('should run the method when this instance is the leader', async () => {
      // Given
      registerLeaderServiceGetter(() => ({ isLeader: () => true }));
      class Jobs {
        @LeaderOnly()
        async run(value: number): Promise<number> {
          return value * 2;
        }
      }

      // When
      const result = await new Jobs().run(21);

      // Then
      expect(result).toBe(42);
    });

    it('should skip the method when this instance is a follower', async () => {
      // Given
      const isLeader = vi.fn().mockReturnValue(false);
      registerLeaderServiceGetter(() => ({ isLeader }));
      const body = vi.fn();
      class Jobs {
        @LeaderOnly()
        async run(): Promise<void> {
          body();
        }
      }

      // When
      const result = await new Jobs().run();

      // Then
      expect(result).toBeUndefined();
      expect(body).not.toHaveBeenCalled();
      expect(isLeader).toHaveBeenCalledWith('default');
    });

    it('should check leadership of the configured group', async () => {
      // Given
      const isLeader = vi.fn().mockReturnValue(true);
      registerLeaderServiceGetter(() => ({ isLeader }));
      class Jobs {
        @LeaderOnly({ group: 'reports' })
        async run(): Promise<string> {
          return 'ran';
        }
      }

      // When
      await new Jobs().run();

      // Then
      expect(isLeader).toHaveBeenCalledWith('reports');
    });

    it('should preserve this-binding and arguments', async () => {
      // Given
      registerLeaderServiceGetter(() => ({ isLeader: () => true }));
      class Jobs {
        prefix = 'job:';

        @LeaderOnly()
        async name(suffix: string): Promise<string> {
          return this.prefix + suffix;
        }
      }

      // When/Then
      expect(await new Jobs().name('daily')).toBe('job:daily');
    });
  });

  describe('metadata', () => {
    it('should preserve the method name and expose options metadata on the wrapper', () => {
      // Given
      class Jobs {
        @LeaderOnly({ group: 'reports' })
        async nightly(): Promise<void> {
          /* noop */
        }
      }

      // Then
      const wrapper = Jobs.prototype.nightly;
      expect(wrapper.name).toBe('nightly');
      expect(Reflect.getMetadata(LEADER_ONLY_OPTIONS, wrapper)).toEqual({ group: 'reports' });
    });

    it('should carry metadata stamped by decorators applied before it — @Cron below @LeaderOnly must not silently unregister the job', async () => {
      // Given — a method already stamped by an earlier decorator. Source order
      // `@LeaderOnly()` above `@Cron()` applies @Cron FIRST, to the ORIGINAL
      // method; the scheduler later discovers jobs by reading metadata off the
      // prototype's method — which is the wrapper.
      const CRON_METADATA = 'test:schedule-expression';
      class Jobs {
        async nightly(): Promise<string> {
          return 'ran';
        }
      }
      const descriptor = Object.getOwnPropertyDescriptor(Jobs.prototype, 'nightly')!;
      Reflect.defineMetadata(CRON_METADATA, '0 3 * * *', descriptor.value);

      // When — @LeaderOnly wraps the stamped method
      LeaderOnly()(Jobs.prototype, 'nightly', descriptor);
      Object.defineProperty(Jobs.prototype, 'nightly', descriptor);

      // Then — the wrapper carries the earlier decorator's metadata (the cron
      // stays registered) AND still gates execution
      const wrapper = Jobs.prototype.nightly;
      expect(Reflect.getMetadata(CRON_METADATA, wrapper)).toBe('0 3 * * *');
      expect(Reflect.getMetadata(LEADER_ONLY_OPTIONS, wrapper)).toEqual({});
      expect(await new Jobs().nightly()).toBeUndefined(); // no service → skip
    });
  });

  describe('service getter lifecycle (initializer)', () => {
    it('should unregister its getter on destroy so a closed app cannot answer for decorated methods', async () => {
      // Given — an initialized app whose leader service says "leader"
      const leaderService = { isLeader: vi.fn().mockReturnValue(true) };
      const initializer = new LeaderDecoratorInitializerService(leaderService as never);
      initializer.onModuleInit();
      class Jobs {
        @LeaderOnly()
        async run(): Promise<string> {
          return 'ran';
        }
      }
      expect(await new Jobs().run()).toBe('ran');

      // When — the app shuts down
      initializer.onModuleDestroy();

      // Then — late cron ticks skip fail-safe instead of consulting the
      // destroyed service
      expect(await new Jobs().run()).toBeUndefined();
      expect(leaderService.isLeader).toHaveBeenCalledTimes(1);
    });

    it('should not clobber a getter registered by a newer initializer (two apps in one process)', async () => {
      // Given — app A initialized, then app B initialized (B's getter wins)
      const first = new LeaderDecoratorInitializerService({ isLeader: () => false } as never);
      const secondService = { isLeader: vi.fn().mockReturnValue(true) };
      const second = new LeaderDecoratorInitializerService(secondService as never);
      first.onModuleInit();
      second.onModuleInit();

      // When — app A closes AFTER app B took over
      first.onModuleDestroy();

      // Then — app B's decorated methods still run
      class Jobs {
        @LeaderOnly()
        async run(): Promise<string> {
          return 'ran';
        }
      }
      expect(await new Jobs().run()).toBe('ran');
      expect(secondService.isLeader).toHaveBeenCalledTimes(1);
    });

    it('should re-expose the surviving app when the NEWER app closes first (no permanent wedge)', async () => {
      // Given — app A initialized, then app B initialized (B's getter is
      // the active one)
      const firstService = { isLeader: vi.fn().mockReturnValue(true) };
      const first = new LeaderDecoratorInitializerService(firstService as never);
      const secondService = { isLeader: vi.fn().mockReturnValue(true) };
      const second = new LeaderDecoratorInitializerService(secondService as never);
      first.onModuleInit();
      second.onModuleInit();

      // When — app B closes FIRST while app A keeps running
      second.onModuleDestroy();

      // Then — app A's decorated methods run again against A's service:
      // with a single-slot registry the survivor would skip forever
      class Jobs {
        @LeaderOnly()
        async run(): Promise<string> {
          return 'ran';
        }
      }
      expect(await new Jobs().run()).toBe('ran');
      expect(firstService.isLeader).toHaveBeenCalledTimes(1);
      expect(secondService.isLeader).not.toHaveBeenCalled();
    });

    it('should reject bare @LeaderOnly (no parentheses) — the factory used AS the decorator would silently leave the method UNGATED', () => {
      // Given — plain-JS/Babel apps can apply the factory directly with
      // (prototype, key, descriptor); the returned inner function would be
      // treated as an empty descriptor and the method would run everywhere
      class Jobs {
        async run(): Promise<string> {
          return 'ran';
        }
      }
      const descriptor = Object.getOwnPropertyDescriptor(Jobs.prototype, 'run')!;

      // When/Then
      expect(() => (LeaderOnly as unknown as (t: object, k: string, d: PropertyDescriptor) => unknown)(Jobs.prototype, 'run', descriptor)).toThrow(InvalidLeaderConfigError);
    });

    it('should reject array options and unknown option keys — both would silently gate the DEFAULT group', () => {
      // When/Then — a plausible "list of groups" guess
      expect(() => {
        class Jobs {
          @LeaderOnly(['cleanup'] as never)
          async run(): Promise<string> {
            return 'ran';
          }
        }
        void Jobs;
      }).toThrow(InvalidLeaderConfigError);

      // And — a plural-key typo (no "group" present → certainly a mistake)
      expect(() => {
        class Jobs {
          @LeaderOnly({ groups: 'cleanup' } as never)
          async run(): Promise<string> {
            return 'ran';
          }
        }
        void Jobs;
      }).toThrow(InvalidLeaderConfigError);

      // And — a null-valued group must not disarm the typo net (null names
      // no group; with an unknown key alongside it is certainly a typo)
      expect(() => {
        class Jobs {
          @LeaderOnly({ group: null, groups: 'cleanup' } as never)
          async run(): Promise<string> {
            return 'ran';
          }
        }
        void Jobs;
      }).toThrow(InvalidLeaderConfigError);

      // But — extra keys ALONGSIDE a valid group cannot mis-gate and stay
      // accepted (widened config objects are legal structural typing)
      expect(() => {
        class Jobs {
          @LeaderOnly({ group: 'reports', timeoutMs: 5000 } as never)
          async run(): Promise<string> {
            return 'ran';
          }
        }
        void Jobs;
      }).not.toThrow();
      expect(getRegisteredLeaderGroups().has('reports')).toBe(true);
    });

    it('should reject a thenable options argument — an un-awaited async helper has zero own keys and would silently gate the DEFAULT group', () => {
      // When/Then — @LeaderOnly(loadOptions()) with an async loadOptions:
      // the Promise slips past the unknown-keys typo net (nothing to see)
      expect(() => {
        class Jobs {
          @LeaderOnly(Promise.resolve({ group: 'cleanup' }) as never)
          async run(): Promise<string> {
            return 'ran';
          }
        }
        void Jobs;
      }).toThrow(InvalidLeaderConfigError);
      expect(() => {
        class Jobs {
          @LeaderOnly(Promise.resolve({ group: 'cleanup' }) as never)
          async run(): Promise<string> {
            return 'ran';
          }
        }
        void Jobs;
      }).toThrow(/thenable/);
      expect(getRegisteredLeaderGroups().has('cleanup')).toBe(false);
    });

    it('should reject a non-object options argument at class load — a positional group string would silently gate the DEFAULT group', () => {
      // When/Then — the sibling APIs take the group positionally, so this
      // is a plausible JS mistake; ('cleanup').group is undefined and the
      // method would silently register on 'default'
      expect(() => {
        class Jobs {
          @LeaderOnly('cleanup' as never)
          async run(): Promise<string> {
            return 'ran';
          }
        }
        void Jobs;
      }).toThrow(InvalidLeaderConfigError);

      // And — null must fail with the tagged error, not a bare TypeError
      expect(() => {
        class Jobs {
          @LeaderOnly(null as never)
          async run(): Promise<string> {
            return 'ran';
          }
        }
        void Jobs;
      }).toThrow(InvalidLeaderConfigError);
    });

    it('should reject generator and async-generator methods at class load — the gate cannot preserve iterator semantics', () => {
      // When/Then — sync generator
      expect(() => {
        class Jobs {
          @LeaderOnly()
          *stream(): Generator<number> {
            yield 1;
          }
        }
        void Jobs;
      }).toThrow(InvalidLeaderConfigError);

      // When/Then — async generator
      expect(() => {
        class Jobs {
          @LeaderOnly()
          async *streamAsync(): AsyncGenerator<number> {
            yield 1;
          }
        }
        void Jobs;
      }).toThrow(InvalidLeaderConfigError);
    });

    it('should expose the documented test aids on the public package surface', async () => {
      // Given — testing.md and troubleshooting.md instruct users to import
      // these from '@nestjs-redisx/leader' to stub leadership and reset the
      // process-global registries between suites
      const publicApi = await import('../../src');

      // Then
      expect(typeof publicApi.registerLeaderServiceGetter).toBe('function');
      expect(typeof publicApi.unregisterLeaderServiceGetter).toBe('function');
      expect(typeof publicApi.clearRegisteredLeaderGroups).toBe('function');
    });
  });
});
