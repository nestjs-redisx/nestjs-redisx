---
title: 'Testing Overview — NestJS RedisX'
description: 'Test suite structure, coverage targets, and quality assurance for NestJS RedisX.'
---

# Testing Overview

NestJS RedisX includes 8 packages (core + 7 plugins) with a comprehensive test suite across three layers, validated by CI on every push and pull request.

## Test Suite

### Unit tests

Each package has isolated unit tests with mocked Redis. These cover business logic, decorators, error handling, value objects, and service behavior. Unit tests run without any external dependencies.

### Integration tests

Integration tests verify packages against a real Redis instance. They validate Lua scripts, atomic operations, connection management, multi-client support, and plugin lifecycle hooks.

### E2E tests

End-to-end tests boot a full NestJS application with all plugins registered. They test HTTP endpoints, decorator behavior, cross-plugin interaction, and the complete request lifecycle.

## Coverage by Package

| Package | Tests | Line Coverage | Branch Coverage |
|---------|-------|---------------|-----------------|
| core | 630+ | 92% | 89% |
| cache | 500+ | 91% | 88% |
| locks | 250+ | 93% | 90% |
| rate-limit | 200+ | 91% | 87% |
| idempotency | 150+ | 90% | 88% |
| streams | 150+ | 77% | 75% |
| metrics | 100+ | 90% | 87% |
| tracing | 100+ | 90% | 86% |

Streams coverage is lower due to consumer-group scenarios and cluster routing paths that are E2E-heavy — improving.

Coverage is tracked via [Codecov](https://codecov.io/gh/nestjs-redisx/nestjs-redisx) and enforced in CI via vitest coverage thresholds at 89% lines, 90% functions, and 87% branches.

## Pack-test

Pack-test validates that published packages work correctly when installed from tarballs, simulating the real npm install experience.

**What it does:**

1. Runs `npm pack` on all 8 packages to create tarballs (same artifacts as `npm publish`)
2. Installs tarballs into a clean NestJS project (no monorepo symlinks)
3. Boots a NestJS application with all 7 plugins via DI
4. Tests each plugin through HTTP endpoints
5. Validates: imports resolve, TypeScript compiles, DI wires correctly, plugins function at runtime

**Two levels:**

- **pack-smoke** (every PR) — Import verification and DI bootstrap. Compiles TestingModule with all plugins (DI wiring only, no Redis I/O).
- **pack-e2e** (manual trigger) — Full functional test against a live Redis instance. 13 test suites covering cache, locks, rate limiting, idempotency, streams, metrics, and tracing.

## CI Pipeline

| Trigger | What runs |
|---------|-----------|
| Every push/PR | Lint, typecheck, full test suite (Node 18 + 20), coverage upload, pack-smoke |
| Weekly (Monday) | Compatibility matrix: Node 18/20, NestJS 10/11, Redis 6.2/7.x |
| Manual | pack-e2e with live Redis, NestJS 9 best-effort |

CI workflows are defined in [`.github/workflows/`](https://github.com/nestjs-redisx/nestjs-redisx/tree/main/.github/workflows).
