import { LuaExecutionError } from '../../../shared/errors';

export type TokenType = 'number' | 'string' | 'name' | 'keyword' | 'op' | 'eof';

export type Token = {
  type: TokenType;
  value: string;
};

const KEYWORDS = new Set(['local', 'if', 'then', 'elseif', 'else', 'end', 'for', 'do', 'return', 'and', 'or', 'not', 'nil', 'true', 'false']);

// Multi-character operators must be matched before single-character ones.
const MULTI_OPS = ['==', '~=', '<=', '>=', '..'];
const SINGLE_OPS = new Set(['+', '-', '*', '/', '%', '<', '>', '=', '#', '(', ')', '[', ']', '{', '}', ',', '.']);

/**
 * Tokenizes the supported Lua subset. Supports `--` line comments, single/double
 * quoted strings, integer/float numbers, identifiers, keywords and operators.
 */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  const isDigit = (c: string): boolean => c >= '0' && c <= '9';
  const isNameStart = (c: string): boolean => c === '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
  const isNamePart = (c: string): boolean => isNameStart(c) || isDigit(c);

  while (i < n) {
    const c = src[i]!;

    // whitespace
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++;
      continue;
    }

    // line comment: -- ... (note: long comments --[[ ]] are not used by our scripts)
    if (c === '-' && src[i + 1] === '-') {
      i += 2;
      while (i < n && src[i] !== '\n') i++;
      continue;
    }

    // strings
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      let str = '';
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') {
          const next = src[i + 1];
          str += next === 'n' ? '\n' : next === 't' ? '\t' : (next ?? '');
          i += 2;
        } else {
          str += src[i];
          i++;
        }
      }
      if (i >= n) throw new LuaExecutionError('unterminated string literal');
      i++; // closing quote
      tokens.push({ type: 'string', value: str });
      continue;
    }

    // numbers (integer or float). A leading '.' followed by a digit is a number;
    // otherwise '.' / '..' are operators handled below.
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
      let num = '';
      while (i < n && (isDigit(src[i]!) || src[i] === '.')) {
        num += src[i];
        i++;
      }
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // identifiers / keywords
    if (isNameStart(c)) {
      let name = '';
      while (i < n && isNamePart(src[i]!)) {
        name += src[i];
        i++;
      }
      tokens.push({ type: KEYWORDS.has(name) ? 'keyword' : 'name', value: name });
      continue;
    }

    // multi-char operators
    const two = src.slice(i, i + 2);
    if (MULTI_OPS.includes(two)) {
      tokens.push({ type: 'op', value: two });
      i += 2;
      continue;
    }

    // single-char operators
    if (SINGLE_OPS.has(c)) {
      tokens.push({ type: 'op', value: c });
      i++;
      continue;
    }

    throw new LuaExecutionError(`unexpected character '${c}'`);
  }

  tokens.push({ type: 'eof', value: '' });
  return tokens;
}
