import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: false, // Generate types separately with tsc
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: ['@nestjs/common', '@nestjs/core', '@nestjs-redisx/core', 'reflect-metadata', 'rxjs', 'express-session', '@fastify/session'],
  onSuccess: () => {
    // Declarations are emitted via tsc (dts: false above); a declaration
    // hiccup keeps the historical `|| true` behavior and never fails the JS
    // build. Not a shell string: tsup runs onSuccess strings through
    // tinyexec, which mangles `../` path segments.
    try {
      execSync('tsc --declaration --emitDeclarationOnly --outDir dist --skipLibCheck --noCheck', { stdio: 'inherit' });
    } catch {
      // best-effort — see above
    }
    // ESM-context declaration stub for the `exports.import` entry: without
    // it TypeScript (moduleResolution node16/bundler) types the ESM bundle
    // through the CommonJS index.d.ts — the "ESM entry masquerading as CJS"
    // resolution mismatch. `export *` forwards the whole declaration tree
    // (every package uses named exports only).
    writeFileSync(join(process.cwd(), 'dist', 'index.d.mts'), "export * from './index.js';\n");
    // tsup's onSuccess type requires a Promise return; the body is fully
    // synchronous, so resolve immediately.
    return Promise.resolve();
  },
});
