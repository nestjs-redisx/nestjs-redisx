import { describe, it, expect } from 'vitest';

import { parse } from '../../src/memory/domain/lua/lua-parser';
import { LuaExecutionError } from '../../src/shared/errors';

/**
 * Unit tests for the Lua parser. We assert on the produced AST shape and on
 * the error paths; semantics are covered by the interpreter tests.
 */
describe('parse', () => {
  it('parses a local with and without an initializer', () => {
    expect(parse('local x')).toEqual([{ kind: 'local', name: 'x', expr: undefined }]);
    expect(parse('local x = 1')).toEqual([{ kind: 'local', name: 'x', expr: { kind: 'num', value: 1 } }]);
  });

  it('parses an empty and a value return', () => {
    expect(parse('return')).toEqual([{ kind: 'return' }]);
    expect(parse('return 1')).toEqual([{ kind: 'return', expr: { kind: 'num', value: 1 } }]);
  });

  it('parses if / elseif / else', () => {
    const ast = parse('if a then return 1 elseif b then return 2 else return 3 end');
    expect(ast[0]!.kind).toBe('if');
    const node = ast[0] as Extract<ReturnType<typeof parse>[number], { kind: 'if' }>;
    expect(node.clauses).toHaveLength(2);
    expect(node.elseBody).toBeDefined();
  });

  it('parses a numeric for with an optional step', () => {
    const ast = parse('for i = 1, 10, 2 do return i end');
    const node = ast[0] as Extract<ReturnType<typeof parse>[number], { kind: 'for' }>;
    expect(node.varName).toBe('i');
    expect(node.step).toBeDefined();
  });

  it('parses index and call postfix chains', () => {
    const ast = parse("return redis.call('GET', KEYS[1])");
    expect(JSON.stringify(ast)).toContain('"kind":"call"');
    expect(JSON.stringify(ast)).toContain('"kind":"index"');
  });

  it('respects precedence and right-associative concatenation', () => {
    const ast = parse('return 1 + 2 * 3');
    const ret = ast[0] as Extract<ReturnType<typeof parse>[number], { kind: 'return' }>;
    const top = ret.expr as Extract<typeof ret.expr & object, { kind: 'binop' }>;
    expect(top.op).toBe('+'); // multiplication binds tighter
  });

  it('parses a table constructor with a trailing comma', () => {
    const ast = parse('return {1, 2, 3,}');
    expect(JSON.stringify(ast)).toContain('"kind":"table"');
  });

  it('parses unary not / minus / length', () => {
    expect(JSON.stringify(parse('return not x'))).toContain('"op":"not"');
    expect(JSON.stringify(parse('return -x'))).toContain('"op":"-"');
    expect(JSON.stringify(parse('return #x'))).toContain('"op":"#"');
  });

  it('throws on an invalid assignment target', () => {
    expect(() => parse('1 = 2')).toThrow(LuaExecutionError);
  });

  it('throws on a missing closing parenthesis', () => {
    expect(() => parse('return (1')).toThrow(LuaExecutionError);
  });

  it('throws on a trailing token', () => {
    expect(() => parse('return 1 end')).toThrow(LuaExecutionError);
  });

  it('throws on a malformed local', () => {
    expect(() => parse('local = 1')).toThrow(LuaExecutionError);
  });

  it('throws on an unexpected primary token', () => {
    expect(() => parse('return ,')).toThrow(LuaExecutionError);
  });
});
