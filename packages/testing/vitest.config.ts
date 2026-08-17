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
      // Sibling packages resolve to sources so the core driver registry (and
      // the in-memory pub/sub bus) are single shared instances.
      '@nestjs-redisx/core': path.resolve(__dirname, '../core/src'),
      '@nestjs-redisx/pubsub': path.resolve(__dirname, '../pubsub/src'),
      '@nestjs-redisx/circuit-breaker': path.resolve(__dirname, '../circuit-breaker/src'),
      '@nestjs-redisx/cache': path.resolve(__dirname, '../cache/src'),
      '@nestjs-redisx/locks': path.resolve(__dirname, '../locks/src'),
      '@nestjs-redisx/rate-limit': path.resolve(__dirname, '../rate-limit/src'),
      '@nestjs-redisx/idempotency': path.resolve(__dirname, '../idempotency/src'),
      '@nestjs-redisx/streams': path.resolve(__dirname, '../streams/src'),
      '@nestjs-redisx/session': path.resolve(__dirname, '../session/src'),
    },
  },
});
