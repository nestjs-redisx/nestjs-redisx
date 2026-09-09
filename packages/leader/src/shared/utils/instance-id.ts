import { randomBytes } from 'crypto';
import { hostname } from 'os';

/**
 * Generates a human-debuggable unique identity for this process:
 * `<hostname>-<pid>-<random>`. Stored as the election key's value, visible
 * via `getLeaderId()` and in Redis directly. 48 bits of randomness: two
 * replicas sharing an id would BOTH win the election (the acquire script
 * re-claims a key holding the caller's own id), so collisions must stay
 * negligible even when hostname and pid coincide (containers with a pinned
 * hostname all running PID 1).
 */
export function generateInstanceId(): string {
  return `${hostname()}-${process.pid}-${randomBytes(6).toString('hex')}`;
}
