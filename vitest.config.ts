import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 2,
      },
    },
    include: ['packages/**/*.spec.ts', 'packages/**/test/unit/**/*.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/test/integration/**', '**/test/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      include: ['packages/**/src/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.test.ts', '**/test/**', '**/__tests__/**', '**/__mocks__/**', '**/index.ts', '**/index.d.ts', '**/*.d.ts', '**/*.interface.ts', '**/*.types.ts', '**/node_modules/**', '**/dist/**'],
      all: true,
      thresholds: {
        lines: 89,
        functions: 90,
        branches: 87,
        statements: 89,
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@nestjs-redisx/core': resolve(__dirname, './packages/core/src'),
      '@nestjs-redisx/cache': resolve(__dirname, './packages/cache/src'),
      '@nestjs-redisx/locks': resolve(__dirname, './packages/locks/src'),
      '@nestjs-redisx/rate-limit': resolve(__dirname, './packages/rate-limit/src'),
      '@nestjs-redisx/idempotency': resolve(__dirname, './packages/idempotency/src'),
      '@nestjs-redisx/streams': resolve(__dirname, './packages/streams/src'),
      '@nestjs-redisx/metrics': resolve(__dirname, './packages/metrics/src'),
      '@nestjs-redisx/tracing': resolve(__dirname, './packages/tracing/src'),
    },
  },
});
