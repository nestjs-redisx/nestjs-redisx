import { describe, it, expect } from 'vitest';

import { tokenize } from '../../src/memory/domain/lua/lua-lexer';
import { LuaExecutionError } from '../../src/shared/errors';

/**
 * Unit tests for the Lua lexer.
 */
describe('tokenize', () => {
  const types = (src: string): string[] => tokenize(src).map((t) => t.type);
  const values = (src: string): string[] => tokenize(src).map((t) => t.value);

  it('skips whitespace and ends with eof', () => {
    expect(types('  \t\r\n')).toEqual(['eof']);
  });

  it('ignores line comments', () => {
    const toks = tokenize('local x = 1 -- a comment\nlocal y = 2');
    expect(toks.filter((t) => t.type === 'keyword' && t.value === 'local')).toHaveLength(2);
  });

  it('tokenizes single and double quoted strings with escapes', () => {
    expect(tokenize('"a\\nb"')[0]).toEqual({ type: 'string', value: 'a\nb' });
    expect(tokenize("'a\\tb'")[0]).toEqual({ type: 'string', value: 'a\tb' });
    expect(tokenize('"a\\xb"')[0]).toEqual({ type: 'string', value: 'axb' });
  });

  it('throws on an unterminated string', () => {
    expect(() => tokenize('"oops')).toThrow(LuaExecutionError);
  });

  it('tokenizes integers and floats, including a leading dot', () => {
    expect(tokenize('42')[0]).toEqual({ type: 'number', value: '42' });
    expect(tokenize('3.14')[0]).toEqual({ type: 'number', value: '3.14' });
    expect(tokenize('.5')[0]).toEqual({ type: 'number', value: '.5' });
  });

  it('distinguishes keywords from names', () => {
    expect(tokenize('local')[0]!.type).toBe('keyword');
    expect(tokenize('myVar')[0]!.type).toBe('name');
    expect(tokenize('_x1')[0]!.type).toBe('name');
  });

  it('matches multi-char operators before single ones', () => {
    expect(values('a == b')).toEqual(['a', '==', 'b', '']);
    expect(values('a ~= b')).toEqual(['a', '~=', 'b', '']);
    expect(values('a .. b')).toEqual(['a', '..', 'b', '']);
    expect(values('a <= b >= c')).toEqual(['a', '<=', 'b', '>=', 'c', '']);
  });

  it('tokenizes single-char operators', () => {
    expect(values('+ - * / % ( ) [ ] { } , . # < > =')).toEqual(['+', '-', '*', '/', '%', '(', ')', '[', ']', '{', '}', ',', '.', '#', '<', '>', '=', '']);
  });

  it('throws on an unexpected character', () => {
    expect(() => tokenize('local x = @')).toThrow(LuaExecutionError);
  });
});
