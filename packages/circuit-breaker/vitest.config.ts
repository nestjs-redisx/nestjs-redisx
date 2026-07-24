import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/test/**/*.spec.ts', 'src/**/*.spec.ts', 'test/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/test/**', 'src/**/index.ts', 'src/**/*.d.ts', '**/node_modules/**', '**/dist/**'],
      all: true,
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
