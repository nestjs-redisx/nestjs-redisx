/**
 * Interface for context providers (CLS, AsyncLocalStorage, custom).
 * Users implement this to integrate their own context management.
 *
 * This is an adapter interface - no external dependencies required.
 * Users can integrate any context management solution by implementing this interface.
 *
 * @example nestjs-cls integration
 * ```typescript
 * import { ClsService } from 'nestjs-cls';
 *
 * const provider: IContextProvider = {
 *   get: (key) => clsService.get(key),
 * };
 * ```
 *
 * @example AsyncLocalStorage integration
 * ```typescript
 * import { AsyncLocalStorage } from 'async_hooks';
 *
 * const als = new AsyncLocalStorage<Map<string, any>>();
 * const provider: IContextProvider = {
 *   get: (key) => als.getStore()?.get(key),
 * };
 * ```
 *
 * @example Custom context integration
 * ```typescript
 * class MyContextManager {
 *   private context = new Map<string, any>();
 *
 *   get(key: string) {
 *     return this.context.get(key);
 *   }
 * }
 *
 * const manager = new MyContextManager();
 * const provider: IContextProvider = {
 *   get: (key) => manager.get(key),
 * };
 * ```
 */
export interface IContextProvider {
  /**
   * Get value from context by key.
   *
   * @param key - Context key to retrieve
   * @returns Value from context or undefined if not found
   *
   * @example
   * ```typescript
   * const tenantId = provider.get<string>('tenantId');
   * const userId = provider.get<number>('userId');
   * ```
   */
  get<T = unknown>(key: string): T | undefined;
}
