// Plugin
export { SessionPlugin } from './session.plugin';

// Services
export { SessionService } from './session/application/services/session.service';

// Ports (Interfaces)
export type { ISessionService } from './session/application/ports/session-service.port';
export type { ISessionStore } from './session/application/ports/session-store.port';

// Middleware store adapters
export { toExpressStore, type IExpressSessionStoreOptions } from './session/api/stores/express-session-store';
export { toFastifyStore, type IFastifySessionStore, type IFastifySessionPayload, type IFastifySessionStoreOptions } from './session/api/stores/fastify-session-store';

// Domain
export { parseSessionMetadata, isExpiredByCap, effectiveTtlMs, defaultUserIdExtractor } from './session/domain/session-metadata';
export { validateSessionConfig, type IValidatableSessionConfig } from './session/domain/validate-session-config';

// Types
export type { ISessionPluginOptions, ISessionSetOptions, ISessionMetadata, ISessionInfo, ISessionActivity, ISessionEvents, ISessionEventInfo, SessionLimitPolicy, SessionEndReason, SessionPluginOptions } from './shared/types';

// Errors
export { SessionError, SessionStoreError, InvalidSessionConfigError, SessionLimitExceededError, SessionMiddlewareMissingError, SessionSerializationError } from './shared/errors';

// Constants (DI tokens)
export { SESSION_PLUGIN_OPTIONS, SESSION_SERVICE, SESSION_STORE, SESSION_REDIS_DRIVER, DEFAULT_SESSION_CONFIG } from './shared/constants';
