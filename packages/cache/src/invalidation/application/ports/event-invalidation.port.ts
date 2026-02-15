/**
 * Event invalidation service port.
 */

export interface IInvalidationResult {
  event: string;
  tagsInvalidated: string[];
  keysInvalidated: string[];
  totalKeysDeleted: number;
  duration: number;
  skipped: boolean;
  skipReason?: string;
}

export type InvalidationHandler = (event: string, payload: unknown, result: IInvalidationResult) => void | Promise<void>;

export interface IEventInvalidationService {
  /**
   * Process invalidation event.
   */
  processEvent(event: string, payload: unknown): Promise<IInvalidationResult>;

  /**
   * Emit invalidation event (for internal source).
   */
  emit(event: string, payload: unknown): Promise<void>;

  /**
   * Subscribe to invalidation events.
   */
  subscribe(handler: InvalidationHandler): () => void;
}
