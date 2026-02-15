// Plugin
export { TracingPlugin } from './tracing.plugin';

// Services
export { TracingService } from './tracing/application/services/tracing.service';

// Ports (Interfaces)
export type { ITracingService, ISpan } from './tracing/application/ports';

// Value Objects
export { SpanWrapper } from './tracing/domain/value-objects/span-wrapper.vo';

// Types
export type { ITracingPluginOptions, ISpanOptions } from './shared/types';

// Errors
export { TracingError, TracingInitializationError, SpanCreationError } from './shared/errors';

// Constants
export { TRACING_PLUGIN_OPTIONS, TRACING_SERVICE } from './shared/constants';
