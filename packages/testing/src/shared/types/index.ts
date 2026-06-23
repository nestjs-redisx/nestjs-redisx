/**
 * Options for the in-memory Redis driver.
 *
 * @public
 */
export interface IMemoryDriverOptions {
  /**
   * Seed initial string keys before the test runs.
   *
   * @example { 'user:1': '{"id":1}' }
   */
  seed?: Record<string, string>;

  /**
   * Enable operation logging (inherited driver behavior).
   * @default false
   */
  enableLogging?: boolean;
}
