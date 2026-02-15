---
title: Recipes
description: Real-world tracing patterns and examples
---

# Recipes

Common tracing patterns and real-world examples.

## 1. Order Processing

Trace a multi-step order workflow with nested spans for validation, persistence, and payment. Each step records relevant attributes and events, and payment failures are captured via `recordException`.

<<< @/apps/demo/src/plugins/tracing/recipes/order-processing.usage.ts{typescript}

## 2. User Registration

Trace a user registration flow spanning cache lookups, database queries, password hashing, and email sending. Demonstrates cache hit/miss tracking via span attributes and cross-service span nesting.

<<< @/apps/demo/src/plugins/tracing/recipes/user-registration.usage.ts{typescript}

## 3. Batch Processing

Wrap a batch operation in a parent span with per-item child spans. Tracks success and error counts as attributes, and records exceptions on individual failures without stopping the entire batch.

<<< @/apps/demo/src/plugins/tracing/recipes/batch-processing.usage.ts{typescript}

## Next Steps

- [Troubleshooting](./troubleshooting) — Debug common issues
- [Overview](./index) — Back to overview
