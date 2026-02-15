import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/test/e2e/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 30000, // E2E tests may take longer
    hookTimeout: 30000,
    pool: 'forks', // Use forks for better isolation in E2E tests
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
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
