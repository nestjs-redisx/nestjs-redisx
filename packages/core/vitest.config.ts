import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/unit/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/test/integration/**', '**/test/e2e/**', '**/test/load/**', '**/test/stress/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/test/**', '**/*.spec.ts', '**/*.config.ts'],
    },
  },
});
