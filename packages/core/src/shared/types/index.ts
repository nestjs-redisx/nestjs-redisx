/**
 * Shared types for NestJS RedisX.
 */

/**
 * Generic async function type.
 */
export type AsyncFunction<TArgs extends unknown[] = [], TReturn = unknown> = (...args: TArgs) => Promise<TReturn>;

/**
 * Nullable type helper.
 */
export type Nullable<T> = T | null;

/**
 * Optional type helper.
 */
export type Optional<T> = T | undefined;

/**
 * Makes all properties optional recursively.
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Makes all properties required recursively.
 */
export type DeepRequired<T> = {
  [P in keyof T]-?: T[P] extends object ? DeepRequired<T[P]> : T[P];
};
