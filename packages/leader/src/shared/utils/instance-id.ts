import { randomBytes } from 'crypto';
import { hostname } from 'os';

/**
 * Generates a human-debuggable unique identity for this process:
 * `<hostname>-<pid>-<random>`. Stored as the election key's value, visible
 * via `getLeaderId()` and in Redis directly.
 */
export function generateInstanceId(): string {
  return `${hostname()}-${process.pid}-${randomBytes(3).toString('hex')}`;
}
