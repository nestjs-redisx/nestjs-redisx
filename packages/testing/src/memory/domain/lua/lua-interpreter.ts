import { LuaExecutionError } from '../../../shared/errors';
import { Expr, Stmt, parse } from './lua-parser';
import { RedisCallPort } from './redis-call.port';

/**
 * A Lua table: a unified array+hash map. Integer keys 1..n form the array part.
 */
export class LuaTable {
  readonly map = new Map<number | string, LuaValue>();

  get(key: number | string): LuaValue {
    return this.map.has(key) ? (this.map.get(key) as LuaValue) : null;
  }

  set(key: number | string, value: LuaValue): void {
    if (value === null) this.map.delete(key);
    else this.map.set(key, value);
  }

  /** Lua `#t`: length of the array part (largest n with 1..n present). */
  length(): number {
    let n = 0;
    while (this.map.has(n + 1)) n++;
    return n;
  }
}

export type LuaValue = number | string | boolean | null | LuaTable;

type ReturnSignal = {
  returned: true;
  value: LuaValue;
};

/** Lua truthiness: only nil and false are falsy. */
function truthy(v: LuaValue): boolean {
  return v !== null && v !== false;
}

function luaToString(v: LuaValue): string {
  if (v === null) return 'nil';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === 'string') return v;
  throw new LuaExecutionError('cannot convert table to string');
}

function toNumber(v: LuaValue): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isNaN(n)) throw new LuaExecutionError(`cannot convert '${v}' to number`);
    return n;
  }
  throw new LuaExecutionError('arithmetic on non-number');
}

/**
 * Tree-walking interpreter for the supported Lua subset, executing Redis scripts
 * against an in-memory store via a RedisCallPort. Pure (no NestJS / no I/O).
 */
export class LuaInterpreter {
  /**
   * Runs a Redis Lua script.
   *
   * @param source - Lua source
   * @param keys - KEYS array (strings)
   * @param argv - ARGV array (strings)
   * @param redisCall - bridge to execute redis.call(cmd, ...args)
   * @returns the script's return value converted to a Redis reply
   */
  run(source: string, keys: string[], argv: string[], redisCall: RedisCallPort): unknown {
    const program = parse(source);
    const env = new Map<string, LuaValue>();
    env.set('KEYS', this.arrayTable(keys));
    env.set('ARGV', this.arrayTable(argv));

    const result = this.execBlock(program, env, redisCall);
    return result ? this.luaToRedis(result.value) : null;
  }

  private arrayTable(items: string[]): LuaTable {
    const t = new LuaTable();
    items.forEach((item, idx) => t.set(idx + 1, item));
    return t;
  }

  private execBlock(stmts: Stmt[], env: Map<string, LuaValue>, redisCall: RedisCallPort): ReturnSignal | undefined {
    for (const stmt of stmts) {
      const sig = this.execStmt(stmt, env, redisCall);
      if (sig) return sig;
    }
    return undefined;
  }

  private execStmt(stmt: Stmt, env: Map<string, LuaValue>, redisCall: RedisCallPort): ReturnSignal | undefined {
    switch (stmt.kind) {
      case 'local':
        env.set(stmt.name, stmt.expr ? this.evalExpr(stmt.expr, env, redisCall) : null);
        return undefined;

      case 'assign': {
        const value = this.evalExpr(stmt.expr, env, redisCall);
        if (stmt.target.kind === 'name') {
          env.set(stmt.target.name, value);
        } else if (stmt.target.kind === 'index') {
          const obj = this.evalExpr(stmt.target.obj, env, redisCall);
          if (!(obj instanceof LuaTable)) throw new LuaExecutionError('index assignment on non-table');
          const key = this.normalizeKey(this.evalExpr(stmt.target.key, env, redisCall));
          obj.set(key, value);
        } else {
          throw new LuaExecutionError('invalid assignment target');
        }
        return undefined;
      }

      case 'if': {
        for (const clause of stmt.clauses) {
          if (truthy(this.evalExpr(clause.cond, env, redisCall))) {
            return this.execBlock(clause.body, env, redisCall);
          }
        }
        if (stmt.elseBody) return this.execBlock(stmt.elseBody, env, redisCall);
        return undefined;
      }

      case 'for': {
        const from = toNumber(this.evalExpr(stmt.from, env, redisCall));
        const to = toNumber(this.evalExpr(stmt.to, env, redisCall));
        const step = stmt.step ? toNumber(this.evalExpr(stmt.step, env, redisCall)) : 1;
        if (step === 0) throw new LuaExecutionError("'for' step is zero");
        const had = env.has(stmt.varName);
        const prev = env.get(stmt.varName);
        for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
          env.set(stmt.varName, i);
          const sig = this.execBlock(stmt.body, env, redisCall);
          if (sig) {
            this.restore(env, stmt.varName, had, prev);
            return sig;
          }
        }
        this.restore(env, stmt.varName, had, prev);
        return undefined;
      }

      case 'return':
        return { returned: true, value: stmt.expr ? this.evalExpr(stmt.expr, env, redisCall) : null };

      case 'exprStmt':
        this.evalExpr(stmt.expr, env, redisCall);
        return undefined;
    }
  }

  private restore(env: Map<string, LuaValue>, name: string, had: boolean, prev: LuaValue | undefined): void {
    if (had) env.set(name, prev as LuaValue);
    else env.delete(name);
  }

  private evalExpr(expr: Expr, env: Map<string, LuaValue>, redisCall: RedisCallPort): LuaValue {
    switch (expr.kind) {
      case 'num':
        return expr.value;
      case 'str':
        return expr.value;
      case 'bool':
        return expr.value;
      case 'nil':
        return null;
      case 'name':
        return env.has(expr.name) ? (env.get(expr.name) as LuaValue) : null;

      case 'index': {
        const obj = this.evalExpr(expr.obj, env, redisCall);
        if (!(obj instanceof LuaTable)) {
          // `redis`/`math` namespaces are not real tables; field access handled in 'call'
          throw new LuaExecutionError('attempt to index a non-table value');
        }
        return obj.get(this.normalizeKey(this.evalExpr(expr.key, env, redisCall)));
      }

      case 'table': {
        const t = new LuaTable();
        expr.items.forEach((item, idx) => t.set(idx + 1, this.evalExpr(item, env, redisCall)));
        return t;
      }

      case 'unop':
        return this.evalUnop(expr.op, this.evalExpr(expr.expr, env, redisCall));

      case 'binop':
        return this.evalBinop(expr, env, redisCall);

      case 'call':
        return this.evalCall(expr, env, redisCall);
    }
  }

  private normalizeKey(key: LuaValue): number | string {
    if (typeof key === 'number') return key;
    if (typeof key === 'string') return key;
    throw new LuaExecutionError('invalid table key');
  }

  private evalUnop(op: string, v: LuaValue): LuaValue {
    switch (op) {
      case 'not':
        return !truthy(v);
      case '-':
        return -toNumber(v);
      case '#':
        if (typeof v === 'string') return v.length;
        if (v instanceof LuaTable) return v.length();
        throw new LuaExecutionError('attempt to get length of a non-string/table');
      default:
        throw new LuaExecutionError(`unsupported unary operator '${op}'`);
    }
  }

  private evalBinop(expr: Extract<Expr, { kind: 'binop' }>, env: Map<string, LuaValue>, redisCall: RedisCallPort): LuaValue {
    const { op } = expr;
    // short-circuit logicals
    if (op === 'and') {
      const left = this.evalExpr(expr.left, env, redisCall);
      return truthy(left) ? this.evalExpr(expr.right, env, redisCall) : left;
    }
    if (op === 'or') {
      const left = this.evalExpr(expr.left, env, redisCall);
      return truthy(left) ? left : this.evalExpr(expr.right, env, redisCall);
    }

    const l = this.evalExpr(expr.left, env, redisCall);
    const r = this.evalExpr(expr.right, env, redisCall);

    switch (op) {
      case '..':
        return luaToString(l) + luaToString(r);
      case '==':
        return this.luaEquals(l, r);
      case '~=':
        return !this.luaEquals(l, r);
      case '<':
        return this.compare(l, r) < 0;
      case '<=':
        return this.compare(l, r) <= 0;
      case '>':
        return this.compare(l, r) > 0;
      case '>=':
        return this.compare(l, r) >= 0;
      case '+':
        return toNumber(l) + toNumber(r);
      case '-':
        return toNumber(l) - toNumber(r);
      case '*':
        return toNumber(l) * toNumber(r);
      case '/':
        return toNumber(l) / toNumber(r);
      case '%': {
        const a = toNumber(l);
        const b = toNumber(r);
        return a - Math.floor(a / b) * b;
      }
      default:
        throw new LuaExecutionError(`unsupported operator '${op}'`);
    }
  }

  private luaEquals(a: LuaValue, b: LuaValue): boolean {
    if (typeof a !== typeof b) return false; // Lua: no cross-type numeric/string equality
    return a === b;
  }

  private compare(a: LuaValue, b: LuaValue): number {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
    throw new LuaExecutionError('attempt to compare incompatible values');
  }

  private evalCall(expr: Extract<Expr, { kind: 'call' }>, env: Map<string, LuaValue>, redisCall: RedisCallPort): LuaValue {
    const callee = expr.callee;
    const args = expr.args.map((a) => this.evalExpr(a, env, redisCall));

    // redis.call(...) / redis.pcall(...)
    if (callee.kind === 'index' && callee.obj.kind === 'name' && callee.obj.name === 'redis' && callee.key.kind === 'str') {
      if (callee.key.value === 'call' || callee.key.value === 'pcall') {
        return this.doRedisCall(args, redisCall);
      }
      throw new LuaExecutionError(`unsupported redis.${callee.key.value}()`);
    }

    // math.floor/ceil/min/max/abs
    if (callee.kind === 'index' && callee.obj.kind === 'name' && callee.obj.name === 'math' && callee.key.kind === 'str') {
      return this.doMath(callee.key.value, args);
    }

    // tonumber(x)
    if (callee.kind === 'name' && callee.name === 'tonumber') {
      const v = args[0] ?? null;
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const n = Number(v);
        return Number.isNaN(n) ? null : n;
      }
      return null;
    }

    // tostring(x)
    if (callee.kind === 'name' && callee.name === 'tostring') {
      return luaToString(args[0] ?? null);
    }

    throw new LuaExecutionError('unsupported function call');
  }

  private doMath(fn: string, args: LuaValue[]): LuaValue {
    const nums = args.map(toNumber);
    switch (fn) {
      case 'floor':
        return Math.floor(nums[0]!);
      case 'ceil':
        return Math.ceil(nums[0]!);
      case 'abs':
        return Math.abs(nums[0]!);
      case 'min':
        return Math.min(...nums);
      case 'max':
        return Math.max(...nums);
      default:
        throw new LuaExecutionError(`unsupported math.${fn}()`);
    }
  }

  private doRedisCall(args: LuaValue[], redisCall: RedisCallPort): LuaValue {
    if (args.length === 0) throw new LuaExecutionError('redis.call requires a command');
    const command = luaToString(args[0]!);
    const callArgs = args.slice(1).map((a): string | number => {
      if (typeof a === 'number') return a;
      if (typeof a === 'string') return a;
      throw new LuaExecutionError('redis.call argument must be string or number');
    });
    return this.redisToLua(redisCall(command, callArgs));
  }

  /** Converts a Redis reply (from the executor) into a Lua value. */
  private redisToLua(reply: unknown): LuaValue {
    if (reply === null || reply === undefined) return null;
    if (typeof reply === 'number') return reply;
    if (typeof reply === 'string') return reply;
    if (typeof reply === 'boolean') return reply ? 1 : null;
    if (Array.isArray(reply)) {
      const t = new LuaTable();
      reply.forEach((el, idx) => t.set(idx + 1, this.redisToLua(el)));
      return t;
    }
    if (typeof reply === 'object') {
      // HGETALL is returned by the executor as an object for the JS driver API,
      // but Redis Lua sees it as a flat [field, value, ...] array. Flatten it.
      const t = new LuaTable();
      let idx = 1;
      for (const [field, value] of Object.entries(reply as Record<string, unknown>)) {
        t.set(idx++, field);
        t.set(idx++, this.redisToLua(value));
      }
      return t;
    }
    throw new LuaExecutionError('unsupported redis reply type from in-memory executor');
  }

  /** Converts a Lua return value into a Redis reply. */
  private luaToRedis(v: LuaValue): unknown {
    if (v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : null;
    if (typeof v === 'number') return Math.floor(v);
    if (typeof v === 'string') return v;
    // LuaTable -> array (stop at first nil, Redis semantics)
    const out: unknown[] = [];
    const len = v.length();
    for (let i = 1; i <= len; i++) {
      out.push(this.luaToRedis(v.get(i)));
    }
    return out;
  }
}
