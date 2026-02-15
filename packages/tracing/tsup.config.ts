import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: false, // Generate types separately with tsc
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: ['@nestjs/common', '@nestjs/core', '@nestjs-redisx/core', 'reflect-metadata', 'rxjs', '@opentelemetry/api', '@opentelemetry/sdk-trace-node', '@opentelemetry/sdk-trace-base', '@opentelemetry/resources', '@opentelemetry/semantic-conventions', '@opentelemetry/exporter-trace-otlp-http'],
  onSuccess: 'tsc --declaration --emitDeclarationOnly --outDir dist --skipLibCheck --noCheck || true',
});
