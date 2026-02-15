import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  dts: {
    resolve: true,
  },
  sourcemap: true,
  clean: true,
  treeshake: false,
  splitting: false,
  minify: false,
  target: 'es2022',
  tsconfig: './tsconfig.json',
  external: ['@nestjs/common', '@nestjs/core', 'reflect-metadata', 'rxjs', 'ioredis', 'redis'],
});
