import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/test/integration/**/*.ts', 'packages/**/test/e2e/**/*.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Integration tests run sequentially to avoid Redis conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
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
      '@nestjs-redisx/circuit-breaker': resolve(__dirname, './packages/circuit-breaker/src'),
      '@nestjs-redisx/pubsub': resolve(__dirname, './packages/pubsub/src'),
      // Must resolve to source too: the in-memory driver registers itself into
      // core's driver registry, and that registration must land in the SAME
      // core instance the tests use (aliased above) — otherwise memory-driver
      // integration tests fail with "Unsupported driver type: memory".
      '@nestjs-redisx/testing': resolve(__dirname, './packages/testing/src'),
    },
  },
});
