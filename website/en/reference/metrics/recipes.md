---
title: Recipes
description: Real-world metrics patterns and examples
---

# Recipes

Common metrics patterns and real-world examples.

## 1. API Request Metrics

Track HTTP requests with method, endpoint, and status labels. Registers a counter for total requests, a histogram for request duration, and a counter for errors.

<<< @/apps/demo/src/plugins/metrics/recipes/api-metrics.usage.ts{typescript}

## 2. E-commerce Metrics

Business-specific metrics for order tracking, revenue distribution, processing duration per step, and inventory levels. Uses counters for orders, histograms for order value and processing time, and gauges for current inventory.

<<< @/apps/demo/src/plugins/metrics/recipes/ecommerce-metrics.usage.ts{typescript}

## 3. Background Job Metrics

Track job execution across your worker fleet. Registers counters for processed jobs by type and status, histograms for job duration, and gauges for active jobs and queue depth.

<<< @/apps/demo/src/plugins/metrics/recipes/job-metrics.usage.ts{typescript}

## Next Steps

- [Troubleshooting](./troubleshooting) — Debug common issues
- [Overview](./index) — Back to overview
