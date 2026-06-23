import { LuaExecutionError } from '../../../shared/errors';
import { Token, tokenize } from './lua-lexer';

// --- AST -------------------------------------------------------------------

export type Expr = { kind: 'num'; value: number } | { kind: 'str'; value: string } | { kind: 'bool'; value: boolean } | { kind: 'nil' } | { kind: 'name'; name: string } | { kind: 'index'; obj: Expr; key: Expr } | { kind: 'call'; callee: Expr; args: Expr[] } | { kind: 'table'; items: Expr[] } | { kind: 'unop'; op: string; expr: Expr } | { kind: 'binop'; op: string; left: Expr; right: Expr };

export type Stmt = { kind: 'local'; name: string; expr?: Expr } | { kind: 'assign'; target: Expr; expr: Expr } | { kind: 'if'; clauses: Array<{ cond: Expr; body: Stmt[] }>; elseBody?: Stmt[] } | { kind: 'for'; varName: string; from: Expr; to: Expr; step?: Expr; body: Stmt[] } | { kind: 'return'; expr?: Expr } | { kind: 'exprStmt'; expr: Expr };

// --- Parser ----------------------------------------------------------------

const BINARY_PRECEDENCE: Record<string, number> = {
  or: 1,
  and: 2,
  '==': 3,
  '~=': 3,
  '<': 3,
  '<=': 3,
  '>': 3,
  '>=': 3,
  '..': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

const BLOCK_TERMINATORS = new Set(['end', 'else', 'elseif']);

/** Parses the supported Lua subset into a statement list. */
export function parse(src: string): Stmt[] {
  const tokens = tokenize(src);
  let pos = 0;

  const peek = (): Token => tokens[pos]!;
  const next = (): Token => tokens[pos++]!;
  const isKeyword = (kw: string): boolean => peek().type === 'keyword' && peek().value === kw;
  const isOp = (op: string): boolean => peek().type === 'op' && peek().value === op;

  const expectOp = (op: string): void => {
    if (!isOp(op)) throw new LuaExecutionError(`expected '${op}' but got '${peek().value}'`);
    pos++;
  };
  const expectKeyword = (kw: string): void => {
    if (!isKeyword(kw)) throw new LuaExecutionError(`expected '${kw}' but got '${peek().value}'`);
    pos++;
  };

  function parseBlock(): Stmt[] {
    const stmts: Stmt[] = [];
    while (peek().type !== 'eof' && !(peek().type === 'keyword' && BLOCK_TERMINATORS.has(peek().value))) {
      stmts.push(parseStatement());
    }
    return stmts;
  }

  function parseStatement(): Stmt {
    if (isKeyword('local')) {
      next();
      const name = next();
      if (name.type !== 'name') throw new LuaExecutionError(`expected name after 'local'`);
      let expr: Expr | undefined;
      if (isOp('=')) {
        next();
        expr = parseExpr();
      }
      return { kind: 'local', name: name.value, expr };
    }

    if (isKeyword('if')) return parseIf();
    if (isKeyword('for')) return parseFor();

    if (isKeyword('return')) {
      next();
      // return may be empty (before a block terminator / eof)
      if (peek().type === 'eof' || (peek().type === 'keyword' && BLOCK_TERMINATORS.has(peek().value))) {
        return { kind: 'return' };
      }
      return { kind: 'return', expr: parseExpr() };
    }

    // assignment or expression-statement: parse a prefix expression first
    const prefix = parseExpr();
    if (isOp('=')) {
      next();
      const value = parseExpr();
      if (prefix.kind !== 'name' && prefix.kind !== 'index') {
        throw new LuaExecutionError('invalid assignment target');
      }
      return { kind: 'assign', target: prefix, expr: value };
    }
    return { kind: 'exprStmt', expr: prefix };
  }

  function parseIf(): Stmt {
    expectKeyword('if');
    const clauses: Array<{ cond: Expr; body: Stmt[] }> = [];
    const cond = parseExpr();
    expectKeyword('then');
    clauses.push({ cond, body: parseBlock() });
    while (isKeyword('elseif')) {
      next();
      const c = parseExpr();
      expectKeyword('then');
      clauses.push({ cond: c, body: parseBlock() });
    }
    let elseBody: Stmt[] | undefined;
    if (isKeyword('else')) {
      next();
      elseBody = parseBlock();
    }
    expectKeyword('end');
    return { kind: 'if', clauses, elseBody };
  }

  function parseFor(): Stmt {
    expectKeyword('for');
    const varTok = next();
    if (varTok.type !== 'name') throw new LuaExecutionError(`expected loop variable name`);
    expectOp('=');
    const from = parseExpr();
    expectOp(',');
    const to = parseExpr();
    let step: Expr | undefined;
    if (isOp(',')) {
      next();
      step = parseExpr();
    }
    expectKeyword('do');
    const body = parseBlock();
    expectKeyword('end');
    return { kind: 'for', varName: varTok.value, from, to, step, body };
  }

  // expression parsing with precedence climbing
  function parseExpr(minPrec = 0): Expr {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      const opName = t.type === 'keyword' && (t.value === 'and' || t.value === 'or') ? t.value : t.type === 'op' ? t.value : undefined;
      if (opName === undefined) break;
      const prec = BINARY_PRECEDENCE[opName];
      if (prec === undefined || prec < minPrec) break;
      next();
      // '..' is right-associative; others left-associative
      const nextMin = opName === '..' ? prec : prec + 1;
      const right = parseExpr(nextMin);
      left = { kind: 'binop', op: opName, left, right };
    }
    return left;
  }

  function parseUnary(): Expr {
    if (isKeyword('not')) {
      next();
      return { kind: 'unop', op: 'not', expr: parseUnary() };
    }
    if (isOp('-')) {
      next();
      return { kind: 'unop', op: '-', expr: parseUnary() };
    }
    if (isOp('#')) {
      next();
      return { kind: 'unop', op: '#', expr: parseUnary() };
    }
    return parsePostfix();
  }

  function parsePostfix(): Expr {
    let expr = parsePrimary();
    for (;;) {
      if (isOp('.')) {
        next();
        const name = next();
        if (name.type !== 'name' && name.type !== 'keyword') throw new LuaExecutionError('expected field name after .');
        expr = { kind: 'index', obj: expr, key: { kind: 'str', value: name.value } };
      } else if (isOp('[')) {
        next();
        const key = parseExpr();
        expectOp(']');
        expr = { kind: 'index', obj: expr, key };
      } else if (isOp('(')) {
        next();
        const args: Expr[] = [];
        if (!isOp(')')) {
          args.push(parseExpr());
          while (isOp(',')) {
            next();
            args.push(parseExpr());
          }
        }
        expectOp(')');
        expr = { kind: 'call', callee: expr, args };
      } else {
        break;
      }
    }
    return expr;
  }

  function parsePrimary(): Expr {
    const t = peek();
    if (t.type === 'number') {
      next();
      return { kind: 'num', value: Number(t.value) };
    }
    if (t.type === 'string') {
      next();
      return { kind: 'str', value: t.value };
    }
    if (t.type === 'keyword') {
      if (t.value === 'nil') {
        next();
        return { kind: 'nil' };
      }
      if (t.value === 'true' || t.value === 'false') {
        next();
        return { kind: 'bool', value: t.value === 'true' };
      }
    }
    if (t.type === 'name') {
      next();
      return { kind: 'name', name: t.value };
    }
    if (isOp('(')) {
      next();
      const e = parseExpr();
      expectOp(')');
      return e;
    }
    if (isOp('{')) {
      next();
      const items: Expr[] = [];
      if (!isOp('}')) {
        items.push(parseExpr());
        while (isOp(',')) {
          next();
          if (isOp('}')) break; // trailing comma
          items.push(parseExpr());
        }
      }
      expectOp('}');
      return { kind: 'table', items };
    }
    throw new LuaExecutionError(`unexpected token '${t.value}'`);
  }

  const block = parseBlock();
  if (peek().type !== 'eof') throw new LuaExecutionError(`unexpected trailing token '${peek().value}'`);
  return block;
}
