import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/test/load/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 120000, // Load tests can take up to 2 minutes
    hookTimeout: 30000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Run load tests sequentially to avoid resource conflicts
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
