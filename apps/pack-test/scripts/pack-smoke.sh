#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACK_TEST_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$PACK_TEST_DIR/../.." && pwd)"

echo "=== NestJS RedisX Pack Smoke Test ==="
echo "Repo root: $REPO_ROOT"

# Build all packages first
echo ""
echo "Building packages..."
cd "$REPO_ROOT"
npm run build

# Create tarballs
TARBALLS_DIR=$(mktemp -d)
echo ""
echo "Packing to: $TARBALLS_DIR"

PACKAGES=(core cache locks rate-limit idempotency streams metrics tracing)
for pkg in "${PACKAGES[@]}"; do
  echo "Packing @nestjs-redisx/$pkg..."
  (cd "$REPO_ROOT/packages/$pkg" && npm pack --pack-destination "$TARBALLS_DIR")
done

# Create temp smoke project
SMOKE_DIR=$(mktemp -d)
echo ""
echo "Smoke project: $SMOKE_DIR"
cd "$SMOKE_DIR"

npm init -y > /dev/null 2>&1

# Install all tarballs + NestJS deps
echo ""
echo "Installing tarballs + dependencies..."
npm install \
  "$TARBALLS_DIR"/nestjs-redisx-core-*.tgz \
  "$TARBALLS_DIR"/nestjs-redisx-cache-*.tgz \
  "$TARBALLS_DIR"/nestjs-redisx-locks-*.tgz \
  "$TARBALLS_DIR"/nestjs-redisx-rate-limit-*.tgz \
  "$TARBALLS_DIR"/nestjs-redisx-idempotency-*.tgz \
  "$TARBALLS_DIR"/nestjs-redisx-streams-*.tgz \
  "$TARBALLS_DIR"/nestjs-redisx-metrics-*.tgz \
  "$TARBALLS_DIR"/nestjs-redisx-tracing-*.tgz \
  @nestjs/common@^10.3.0 \
  @nestjs/core@^10.3.0 \
  @nestjs/platform-express@^10.3.0 \
  @nestjs/testing@^10.3.0 \
  reflect-metadata@^0.2.0 \
  rxjs@^7.8.0 \
  ioredis@^5.9.0

npm install -D typescript@^5.3.0 vitest@^1.2.0

# Copy smoke test
cp "$PACK_TEST_DIR/test/smoke.spec.ts" "$SMOKE_DIR/smoke.spec.ts"

# Create tsconfig
cat > "$SMOKE_DIR/tsconfig.json" << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strict": false,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["smoke.spec.ts"]
}
EOF

# Create vitest config
cat > "$SMOKE_DIR/vitest.config.ts" << 'EOF'
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['smoke.spec.ts'],
    testTimeout: 30000,
  },
});
EOF

# TypeScript compile check
echo ""
echo "TypeScript compile check..."
npx tsc --noEmit

# Run smoke test
echo ""
echo "Running smoke tests..."
npx vitest run --reporter=verbose

# Cleanup
rm -rf "$TARBALLS_DIR" "$SMOKE_DIR"

echo ""
echo "=== Pack smoke test passed ==="
