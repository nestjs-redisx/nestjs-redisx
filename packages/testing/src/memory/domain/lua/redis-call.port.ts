/**
 * Bridge handed to the Lua interpreter so `redis.call(cmd, ...args)` inside a
 * script can execute against the same in-memory store. Implemented by the
 * application CommandExecutor; the interpreter (domain) only depends on this port.
 */
export type RedisCallPort = (command: string, args: Array<string | number>) => unknown;
