import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    target: 'es2022',
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        target: 'ES2022',
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    cache: false,
    include: ['src/**/test/**/*.spec.ts', 'src/**/*.spec.ts', 'test/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/test/**', 'src/**/index.ts', 'src/**/*.d.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Resolve sibling workspace packages to their sources so the core driver
      // registry is a single shared instance (the memory driver registered by
      // @nestjs-redisx/testing must be visible to the app's RedisModule).
      '@nestjs-redisx/core': path.resolve(__dirname, '../core/src'),
      '@nestjs-redisx/testing': path.resolve(__dirname, '../testing/src'),
    },
  },
});
