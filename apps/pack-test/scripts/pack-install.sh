#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACK_TEST_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$PACK_TEST_DIR/../.." && pwd)"
TARBALLS_DIR="$PACK_TEST_DIR/.tarballs"

echo "=== NestJS RedisX Pack Install ==="
echo "Repo root: $REPO_ROOT"
echo "Tarballs dir: $TARBALLS_DIR"

# Clean and create tarballs directory
rm -rf "$TARBALLS_DIR"
mkdir -p "$TARBALLS_DIR"

# Pack each package
PACKAGES=(core cache locks rate-limit idempotency streams metrics tracing)
for pkg in "${PACKAGES[@]}"; do
  PKG_DIR="$REPO_ROOT/packages/$pkg"
  if [ ! -d "$PKG_DIR" ]; then
    echo "ERROR: Package directory not found: $PKG_DIR"
    exit 1
  fi
  echo "Packing @nestjs-redisx/$pkg..."
  (cd "$PKG_DIR" && npm pack --pack-destination "$TARBALLS_DIR")
done

echo ""
echo "Tarballs created:"
ls -la "$TARBALLS_DIR"/*.tgz

# Install dependencies in pack-test directory
echo ""
echo "Installing dependencies in $PACK_TEST_DIR..."
cd "$PACK_TEST_DIR"
npm install

echo ""
echo "=== Pack install complete ==="
echo "Run 'npm test' to execute the e2e tests."
