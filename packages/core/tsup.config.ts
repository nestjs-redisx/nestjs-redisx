import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  // Dual build: `require` keeps resolving the CJS bundle, `import` gets real
  // ESM — needed for NestJS 12, which ships as native ESM (require()-ing it
  // from a CJS-only build fails on runtimes without require(esm) and under
  // Jest). The optional driver packages (ioredis, redis) are loaded lazily at
  // runtime via createRequire in src/driver/infrastructure/driver-loader.ts,
  // so neither bundle carries a static driver import and users still install
  // only the driver they use.
  format: ['cjs', 'esm'],
  dts: {
    resolve: true,
  },
  sourcemap: true,
  clean: true,
  treeshake: false,
  splitting: false,
  minify: false,
  target: 'es2022',
  // Polyfills __filename in the ESM bundle (derived from import.meta.url) —
  // the driver loader's createRequire(__filename) depends on it.
  shims: true,
  tsconfig: './tsconfig.json',
  external: ['@nestjs/common', '@nestjs/core', 'reflect-metadata', 'rxjs', 'ioredis', 'redis'],
});
