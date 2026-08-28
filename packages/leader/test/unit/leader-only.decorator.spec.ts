import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'reflect-metadata';
import { LeaderOnly, LEADER_ONLY_OPTIONS, registerLeaderServiceGetter, registerLeaderGroup, getRegisteredLeaderGroups, clearRegisteredLeaderGroups } from '../../src/leader/api/decorators/leader-only.decorator';

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
  });
});
