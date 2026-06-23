/**
 * Executes a single Redis command against the in-memory store and returns a
 * Redis-shaped reply. Implemented by CommandExecutor; consumed by the memory
 * driver adapter and (via redis.call) by the Lua interpreter.
 */
export interface ICommandExecutor {
  execute(command: string, args: unknown[]): unknown;
}
