// Plugin
export { LeaderPlugin } from './leader.plugin';

// Services
export { LeaderService } from './leader/application/services/leader.service';

// Ports (Interfaces)
export type { ILeaderService } from './leader/application/ports/leader-service.port';
export type { ILeaderStore } from './leader/application/ports/leader-store.port';

// Store adapters
export { RedisLeaderStoreAdapter } from './leader/infrastructure/adapters/redis-leader-store.adapter';

// Domain
export { LeaderElectionState } from './leader/domain/entities/leader-election-state';

// Decorators
export { LeaderOnly, LEADER_ONLY_OPTIONS, type ILeaderOnlyOptions } from './leader/api/decorators/leader-only.decorator';

// Types
export type { ILeaderPluginOptions, LeaderLostReason } from './shared/types';

// Errors
export { LeaderError, InvalidLeaderConfigError, LeaderStoreError } from './shared/errors';

// Constants
export { LEADER_PLUGIN_OPTIONS, LEADER_SERVICE, LEADER_STORE, LEADER_REDIS_DRIVER, DEFAULT_LEADER_GROUP, MAX_LEADER_TTL_MS } from './shared/constants';
