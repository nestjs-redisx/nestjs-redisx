# Contributing to NestJS RedisX

Thanks for your interest in contributing. This guide covers everything you need to get started.

## Prerequisites

- Node.js 18+ (20 recommended)
- Redis 6.2+ running locally (or Docker)
- npm 9+

## Setup

```bash
# Fork and clone the repo
git clone https://github.com/YOUR_USERNAME/nestjs-redisx.git
cd nestjs-redisx

# Install dependencies
npm install

# Build all packages
npm run build

# Run tests (requires Redis on localhost:6379)
npm test
```

## Monorepo Commands

All commands run from the repo root:

```bash
# Build
npm run build              # Build all packages
npm run build -w @nestjs-redisx/cache  # Build single package

# Test
npm test                   # Unit tests (all packages)
npm run test:e2e           # E2E tests (requires Redis)
npm run test:integration   # Integration tests (requires Redis)
npm test -- --coverage     # Unit tests with coverage

# Code quality
npm run typecheck          # TypeScript compilation check
npm run lint               # ESLint
npm run format             # Prettier auto-fix
npm run format:check       # Prettier check
```

## Running Redis with Docker

```bash
# Standalone Redis
docker run -d --name redis -p 6379:6379 redis:7

# Cluster (for cluster integration tests)
./scripts/docker-cluster-up.sh

# Sentinel (for sentinel integration tests)
./scripts/docker-sentinel-up.sh
```

## Development Workflow

1. Create a branch from `main`:
   - `feat/description` for new features
   - `fix/description` for bug fixes
   - `docs/description` for documentation changes

2. Make your changes in the relevant `packages/` directory.

3. Write or update tests. All new code must have tests. PRs without tests must explain why tests are not applicable.

4. Run checks before committing:

```bash
npm run build
npm test
npm run typecheck
npm run lint
npm run format:check
```

5. Commit using [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(cache): add TTL override for individual keys
fix(locks): handle renewal timeout on slow connections
docs(streams): add consumer group example
test(rate-limit): add sliding window edge cases
chore: update dependencies
```

Format: `type(scope): description`

Types: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `ci`

Scope: package name without the `@nestjs-redisx/` prefix (e.g., `core`, `cache`, `locks`).

6. Push and open a Pull Request against `main`.

## Project Structure

```
packages/
  core/           # Driver abstraction, plugin system
  cache/          # L1+L2 caching, SWR, stampede protection
  locks/          # Distributed locks
  rate-limit/     # Rate limiting algorithms
  idempotency/    # Request deduplication
  streams/        # Redis Streams
  metrics/        # Prometheus metrics
  tracing/        # OpenTelemetry tracing
apps/
  demo/           # Documentation code snippets source
  example/        # Example application
website/          # VitePress documentation site
```

Each package follows the same structure:

```
packages/<name>/
  src/            # Source code
  test/
    unit/         # Unit tests (mocked, no Redis needed)
    integration/  # Integration tests (require Redis)
  package.json
  tsconfig.json
  tsup.config.ts
  vitest.config.ts
```

## Testing

Unit tests are mocked and don't require Redis. Integration tests need a running Redis instance.

```bash
# Unit tests only (no Redis needed)
npm test

# Single package
npm test -w @nestjs-redisx/cache

# Integration tests (Redis required)
npm run test:integration

# E2E tests (Redis required)
npm run test:e2e

# Load and stress tests
npm run test:load
npm run test:stress

# Coverage report
npm test -- --coverage
```

## Code Style

- Prettier for formatting (TypeScript files)
- ESLint for linting
- Both are enforced in CI

Run `npm run format` to auto-fix formatting.

## Pull Request Guidelines

- Keep PRs focused on a single change.
- Include tests for new functionality. If tests are not applicable, explain why in the PR description.
- Update documentation if the change affects the public API.
- Ensure CI passes before requesting review.
- Reference related issues in the PR description (e.g., `Fixes #123`).

## Reporting Bugs

Use the [Bug Report](https://github.com/nestjs-redisx/nestjs-redisx/issues/new?template=bug_report.yml) template. Include a minimal reproduction.

## Requesting Features

Use the [Feature Request](https://github.com/nestjs-redisx/nestjs-redisx/issues/new?template=feature_request.yml) template. Explain the use case and proposed API.

## Questions

For questions and help, use [GitHub Discussions](https://github.com/nestjs-redisx/nestjs-redisx/discussions) instead of issues.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
