import { describe, it, expect, vi } from 'vitest';

import { LuaInterpreter } from '../../src/memory/domain/lua/lua-interpreter';
import { LuaExecutionError } from '../../src/shared/errors';
import type { RedisCallPort } from '../../src/memory/domain/lua/redis-call.port';

/**
 * Unit tests for the tree-walking Lua interpreter.
 */
describe('LuaInterpreter', () => {
  const interp = new LuaInterpreter();
  const noCall: RedisCallPort = () => null;
  const run = (src: string, keys: string[] = [], argv: string[] = [], call: RedisCallPort = noCall): unknown => interp.run(src, keys, argv, call);

  it('returns null for a script with no return', () => {
    expect(run('local x = 1')).toBeNull();
  });

  it('exposes KEYS and ARGV as 1-based arrays', () => {
    expect(run('return KEYS[1]', ['mykey'])).toBe('mykey');
    expect(run('return ARGV[2]', [], ['a', 'b'])).toBe('b');
  });

  it('accumulates in a numeric for loop', () => {
    expect(run('local s = 0\nfor i = 1, 5 do s = s + i end\nreturn s')).toBe(15);
  });

  it('honours a negative for step', () => {
    expect(run('local s = 0\nfor i = 3, 1, -1 do s = s + i end\nreturn s')).toBe(6);
  });

  it('throws when the for step is zero', () => {
    expect(() => run('for i = 1, 3, 0 do end')).toThrow(LuaExecutionError);
  });

  it('returns early from inside a loop', () => {
    expect(run('for i = 1, 10 do if i == 3 then return i end end\nreturn -1')).toBe(3);
  });

  it('evaluates if / elseif / else', () => {
    const src = 'if ARGV[1] == "a" then return 1 elseif ARGV[1] == "b" then return 2 else return 3 end';
    expect(run(src, [], ['a'])).toBe(1);
    expect(run(src, [], ['b'])).toBe(2);
    expect(run(src, [], ['c'])).toBe(3);
  });

  it('short-circuits and / or', () => {
    expect(run('return false and error')).toBeNull(); // false short-circuits, returns false -> nil
    expect(run('return 1 and 2')).toBe(2);
    expect(run('return nil or 7')).toBe(7);
    expect(run('return 5 or 9')).toBe(5);
  });

  it('evaluates arithmetic including modulo and division', () => {
    expect(run('return 2 + 3 * 4')).toBe(14);
    expect(run('return 10 % 3')).toBe(1);
    expect(run('return 7 - 2')).toBe(5);
    expect(run('return 8 / 2')).toBe(4);
  });

  it('concatenates with ..', () => {
    expect(run('return "a" .. 1 .. "b"')).toBe('a1b');
  });

  it('evaluates comparisons and equality', () => {
    expect(run('return 1 < 2')).toBe(1);
    expect(run('return 2 <= 2')).toBe(1);
    expect(run('return 3 > 4')).toBeNull(); // false -> nil
    expect(run('return "a" ~= "b"')).toBe(1);
    expect(run('return 1 == "1"')).toBeNull(); // no cross-type equality
  });

  it('evaluates unary operators', () => {
    expect(run('return -5')).toBe(-5);
    expect(run('return not nil')).toBe(1);
    expect(run('return #"hello"')).toBe(5);
    expect(run('return #{1, 2, 3}')).toBe(3);
  });

  it('supports math.* helpers', () => {
    expect(run('return math.floor(3.9)')).toBe(3);
    expect(run('return math.ceil(3.1)')).toBe(4);
    expect(run('return math.abs(-2)')).toBe(2);
    expect(run('return math.min(3, 1, 2)')).toBe(1);
    expect(run('return math.max(3, 1, 2)')).toBe(3);
  });

  it('supports tonumber and tostring', () => {
    expect(run('return tonumber("42")')).toBe(42);
    expect(run('return tonumber("x")')).toBeNull();
    expect(run('return tonumber(5)')).toBe(5);
    expect(run('return tostring(7)')).toBe('7');
  });

  it('builds and indexes tables, including index assignment', () => {
    expect(run('local t = {}\nt[1] = "x"\nt[2] = "y"\nreturn t')).toEqual(['x', 'y']);
  });

  it('bridges redis.call and converts array replies', () => {
    const call = vi.fn().mockReturnValue(['a', 'b']);
    expect(run("return redis.call('LRANGE', KEYS[1], 0, -1)", ['k'], [], call)).toEqual(['a', 'b']);
    expect(call).toHaveBeenCalledWith('LRANGE', ['k', 0, -1]);
  });

  it('flattens an object reply (HGETALL) into a [field, value, ...] array', () => {
    const call: RedisCallPort = () => ({ tokens: '5', last: '100' });
    expect(run("local h = redis.call('HGETALL', KEYS[1])\nreturn {h[1], h[2], h[3], h[4]}", ['k'], [], call)).toEqual(['tokens', '5', 'last', '100']);
  });

  it('maps a boolean reply to 1 / nil', () => {
    expect(run("return redis.call('SISMEMBER', 'k', 'm')", [], [], () => true)).toBe(1);
    expect(run("return redis.call('SISMEMBER', 'k', 'm')", [], [], () => false)).toBeNull();
  });

  it('stops a returned table array at the first nil (Redis semantics)', () => {
    expect(run('return {1, nil, 3}')).toEqual([1]);
  });

  it('throws on unsupported redis.* and math.* and unknown calls', () => {
    expect(() => run("return redis.foo('x')")).toThrow(LuaExecutionError);
    expect(() => run('return math.sqrt(4)')).toThrow(LuaExecutionError);
    expect(() => run('return unknownfn(1)')).toThrow(LuaExecutionError);
  });

  it('throws when indexing a non-table', () => {
    expect(() => run('local x = 1\nreturn x[1]')).toThrow(LuaExecutionError);
  });

  it('throws when comparing incompatible types', () => {
    expect(() => run('return 1 < "a"')).toThrow(LuaExecutionError);
  });

  it('throws on arithmetic with a non-numeric string', () => {
    expect(() => run('return 1 + "abc"')).toThrow(LuaExecutionError);
  });
});
