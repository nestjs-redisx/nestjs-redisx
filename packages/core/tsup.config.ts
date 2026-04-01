import { defineConfig } from 'tsup';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  dts: {
    resolve: true,
  },
  sourcemap: true,
  clean: true,
  treeshake: false,
  splitting: false,
  minify: false,
  target: 'es2022',
  tsconfig: './tsconfig.json',
  external: ['@nestjs/common', '@nestjs/core', 'reflect-metadata', 'rxjs', 'ioredis', 'redis'],
  onSuccess: async () => {
    // Post-build: wrap top-level requires of optional driver packages (ioredis, redis)
    // with lazy getters so they only load when first accessed.
    // This allows users who only install one driver to import @nestjs-redisx/core.
    const distPath = join(__dirname, 'dist', 'index.js');
    let code = readFileSync(distPath, 'utf-8');

    const lazyHelper = `
// --- Lazy driver loading (optional peer deps) ---
var __lazyMod = {};
function __lazyRequire(pkg) {
  if (!__lazyMod[pkg]) {
    try { __lazyMod[pkg] = require(pkg); } catch { __lazyMod[pkg] = null; }
  }
  return __lazyMod[pkg];
}
// --- End lazy driver loading ---
`;

    // Replace top-level require("ioredis") and require("redis") with lazy wrappers.
    // These appear as: var import_X = require("pkg") or var import_X = __toESM(require("pkg"))
    // We replace the require call itself, keeping surrounding code intact.
    for (const pkg of ['ioredis', 'redis']) {
      // Match: require("pkg") at top level (not inside functions)
      // Replace with a Proxy that lazy-loads
      const pattern = new RegExp(`require\\("${pkg}"\\)`, 'g');
      const replacement = `(new Proxy({}, { get(_, p) { var m = __lazyRequire("${pkg}"); if (!m) return undefined; if (p === "default") return m.default || m; if (p === "__esModule") return true; return m[p]; }, ownKeys() { var m = __lazyRequire("${pkg}"); return m ? Object.getOwnPropertyNames(m) : []; }, getOwnPropertyDescriptor(_, p) { var m = __lazyRequire("${pkg}"); if (!m) return undefined; var d = Object.getOwnPropertyDescriptor(m, p); return d ? { ...d, configurable: true } : { configurable: true, enumerable: true, value: m[p] }; } }))`;
      code = code.replace(pattern, replacement);
    }

    // Inject helper at the top (after the first line which is typically "use strict" or banner)
    const firstNewline = code.indexOf('\n');
    code = code.slice(0, firstNewline + 1) + lazyHelper + code.slice(firstNewline + 1);

    writeFileSync(distPath, code);
  },
});
