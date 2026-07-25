/**
 * Redis glob pattern matching, shared by KEYS / SCAN MATCH and the Pub/Sub
 * bus (PSUBSCRIBE patterns) — one implementation so they cannot diverge.
 */

/** Converts a Redis glob pattern (*, ?, [..]) to a RegExp. */
export function globToRegExp(pattern: string): RegExp {
  let regex = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '*') {
      regex += '.*';
    } else if (ch === '?') {
      regex += '.';
    } else if (ch === '[') {
      // copy the character class as-is up to the closing bracket
      const end = pattern.indexOf(']', i + 1);
      if (end === -1) {
        regex += '\\[';
      } else {
        regex += pattern.slice(i, end + 1);
        i = end;
      }
    } else {
      regex += ch.replace(/[.+^${}()|\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${regex}$`);
}
