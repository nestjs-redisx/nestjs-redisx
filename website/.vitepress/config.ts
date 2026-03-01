import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, type HeadConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

const SITE_URL = 'https://nestjs-redisx.dev';
const OG_IMAGE = `${SITE_URL}/images/og-nestjs-redisx.png`;

// Resolve repo root from config file location: .vitepress/ → website/ → repo root
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default withMermaid(
  defineConfig({
    title: 'NestJS RedisX',
    description: 'Redis toolkit for NestJS with plugin architecture',
    srcDir: '.',
    srcExclude: ['**/PROMPT-*.md'],
    base: '/',
    cleanUrls: true,
    ignoreDeadLinks: [/^https?:\/\/localhost/],

    head: [
      ['link', { rel: 'icon', type: 'image/png', href: '/icons/logo-flat-34x36.png' }],
      ['link', { rel: 'apple-touch-icon', href: '/images/og-nestjs-redisx.png' }],
      ['meta', { name: 'theme-color', content: '#DC382D' }],
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:locale', content: 'en' }],
      ['meta', { property: 'og:site_name', content: 'NestJS RedisX' }],
      ['meta', { property: 'og:image', content: OG_IMAGE }],
      ['meta', { property: 'og:image:width', content: '1200' }],
      ['meta', { property: 'og:image:height', content: '630' }],
      ['meta', { property: 'og:image:alt', content: 'NestJS RedisX — Redis toolkit for NestJS' }],
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
      ['meta', { name: 'twitter:image', content: OG_IMAGE }],
      ['meta', { name: 'twitter:image:alt', content: 'NestJS RedisX — Redis toolkit for NestJS' }],
      ['script', { async: '', src: 'https://www.googletagmanager.com/gtag/js?id=G-CBD9YNFMZ2' }],
      ['script', {}, "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-CBD9YNFMZ2')"],
    ],

    sitemap: {
      hostname: SITE_URL,
    },

    transformHead({ pageData }) {
      const head: HeadConfig[] = [];
      const slug = pageData.relativePath.replace(/\.md$/, '').replace(/\/index$/, '');
      const canonicalUrl = `${SITE_URL}/${slug}`;
      const ogTitle = `${pageData.title} | NestJS RedisX`;

      // Canonical + hreflang
      head.push(['link', { rel: 'canonical', href: canonicalUrl }]);
      head.push(['link', { rel: 'alternate', hreflang: 'en', href: canonicalUrl }]);
      head.push(['link', { rel: 'alternate', hreflang: 'x-default', href: canonicalUrl }]);

      // Per-page Open Graph
      head.push(['meta', { property: 'og:title', content: ogTitle }]);
      head.push(['meta', { property: 'og:url', content: canonicalUrl }]);
      if (pageData.description) {
        head.push(['meta', { property: 'og:description', content: pageData.description }]);
      }

      // Per-page Twitter
      head.push(['meta', { name: 'twitter:title', content: ogTitle }]);
      if (pageData.description) {
        head.push(['meta', { name: 'twitter:description', content: pageData.description }]);
      }

      // JSON-LD: BreadcrumbList
      const NAMES: Record<string, string> = {
        en: 'Home', guide: 'Guide', reference: 'API Reference',
        architecture: 'Architecture', concepts: 'Concepts', recipes: 'Recipes',
        integration: 'Integration', operations: 'Operations', troubleshooting: 'Troubleshooting',
        core: 'Core', cache: 'Cache', locks: 'Locks', 'rate-limit': 'Rate Limit',
        idempotency: 'Idempotency', streams: 'Streams', metrics: 'Metrics',
        tracing: 'Tracing', plugins: 'Plugins',
      };
      const parts = slug.split('/').filter(Boolean);
      if (parts.length >= 2) {
        let url = '';
        const items = parts.map((p, i) => {
          url += `/${p}`;
          return { '@type': 'ListItem', position: i + 1, name: NAMES[p] ?? p.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '), item: `${SITE_URL}${url}` };
        });
        head.push(['script', { type: 'application/ld+json' }, JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items })]);
      }

      // JSON-LD: SoftwareSourceCode (homepage)
      if (pageData.relativePath === 'en/index.md') {
        head.push(['script', { type: 'application/ld+json' }, JSON.stringify({
          '@context': 'https://schema.org', '@type': 'SoftwareSourceCode',
          name: 'NestJS RedisX', alternateName: '@nestjs-redisx/core',
          description: 'Modular Redis toolkit for NestJS with plugin architecture. Provides caching, distributed locks, rate limiting, idempotency, streams, metrics, and tracing.',
          url: SITE_URL, codeRepository: 'https://github.com/nestjs-redisx/nestjs-redisx',
          programmingLanguage: ['TypeScript', 'JavaScript'], runtimePlatform: 'Node.js',
          applicationCategory: 'DeveloperApplication', license: 'https://opensource.org/licenses/MIT',
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        })]);
      }

      // JSON-LD: FAQPage (key pages)
      const FAQ: Record<string, Array<{ q: string; a: string }>> = {
        'en/index.md': [
          { q: 'What is NestJS RedisX?', a: 'NestJS RedisX is a modular Redis toolkit for NestJS. It provides two-tier caching, distributed locks, rate limiting, idempotency, Redis Streams, Prometheus metrics, and OpenTelemetry tracing through a plugin architecture.' },
          { q: 'How is NestJS RedisX different from cache-manager?', a: 'NestJS RedisX offers L1+L2 two-tier caching with anti-stampede protection, stale-while-revalidate, and tag-based invalidation. It also includes distributed locks, rate limiting, idempotency, streams, and observability.' },
          { q: 'Does NestJS RedisX support Redis Cluster and Sentinel?', a: 'Yes. NestJS RedisX supports standalone Redis, Redis Cluster, and Redis Sentinel with both ioredis and node-redis drivers.' },
          { q: 'Can I use ioredis and node-redis with NestJS RedisX?', a: 'Yes. A driver abstraction layer supports both ioredis and node-redis. You can switch drivers without changing application code.' },
        ],
        'en/guide/index.md': [
          { q: 'How do I get started with NestJS RedisX?', a: 'Install @nestjs-redisx/core and desired plugins. Register RedisModule.forRoot() or forRootAsync() with connection config and plugins.' },
          { q: 'Which NestJS RedisX plugins should I use?', a: 'CachePlugin is the most common starting point. Add LocksPlugin for coordination, RateLimitPlugin for API protection, IdempotencyPlugin for payment safety, StreamsPlugin for events, MetricsPlugin and TracingPlugin for observability.' },
        ],
        'en/guide/troubleshooting/index.md': [
          { q: 'Why is my NestJS Redis cache not working?', a: 'Common causes: CachePlugin not registered, key template not matching arguments, TTL set to 0, or Redis not connected.' },
          { q: 'How do I fix lock timeout errors in NestJS RedisX?', a: 'Increase defaultTtl, enable auto-renewal with autoRenew: { enabled: true }, or optimize the locked operation.' },
          { q: 'Why am I getting 429 Too Many Requests?', a: 'Rate limiting is active by default. Increase limits for development or use @SkipRateLimit() on specific endpoints.' },
        ],
        'en/guide/troubleshooting/cache-issues.md': [
          { q: 'Why does @Cached decorator not cache in NestJS?', a: 'Ensure CachePlugin is registered in plugins array, the method is in an @Injectable() class, and key template matches parameters.' },
          { q: 'How do I fix cache stampede in NestJS?', a: 'Enable anti-stampede: new CachePlugin({ stampede: { enabled: true, lockTimeout: 10000 } }).' },
          { q: 'How do I invalidate cache by tags?', a: 'Use @Cached({ tags: ["user:{userId}"] }), then call cacheService.invalidateByTags(["user:123"]).' },
        ],
        'en/guide/troubleshooting/lock-issues.md': [
          { q: 'How do distributed locks work in NestJS RedisX?', a: 'Redis-based locks with auto-renewal. Use @WithLock() decorator or locksService.withLock() programmatically.' },
          { q: 'What happens if the app crashes while holding a lock?', a: 'The lock expires after its TTL. Other instances can then acquire it.' },
        ],
        'en/guide/troubleshooting/performance-issues.md': [
          { q: 'How do I improve Redis cache performance in NestJS?', a: 'Enable L1 in-memory caching: new CachePlugin({ l1: { maxSize: 1000, ttl: 60 } }). Use stale-while-revalidate for non-critical data.' },
          { q: 'How do I monitor Redis performance in NestJS?', a: 'Use MetricsPlugin for Prometheus and TracingPlugin for OpenTelemetry. Monitor hit rates, lock contention, and rate limits via Grafana.' },
        ],
        'en/guide/concepts/two-tier-caching.md': [
          { q: 'What is two-tier caching in Redis?', a: 'Combines fast L1 in-memory cache with shared L2 Redis cache. Hot keys served from memory with zero network latency.' },
          { q: 'What is stale-while-revalidate?', a: 'Serves slightly outdated data immediately while refreshing the cache in the background, eliminating latency spikes.' },
        ],
        'en/guide/concepts/rate-limiting-strategies.md': [
          { q: 'What rate limiting algorithms does NestJS RedisX support?', a: 'Fixed window, sliding window, and token bucket. All run as atomic Lua scripts in Redis.' },
        ],
        'en/reference/cache/index.md': [
          { q: 'What caching features does NestJS RedisX provide?', a: 'L1+L2 two-tier caching, anti-stampede, stale-while-revalidate, tag invalidation, cache warming, custom serializers, and eviction strategies.' },
        ],
        'en/reference/locks/index.md': [
          { q: 'How do I use distributed locks in NestJS?', a: 'Install @nestjs-redisx/locks, add LocksPlugin, use @WithLock() decorator or inject locks service.' },
        ],
        'en/reference/rate-limit/index.md': [
          { q: 'How do I add rate limiting to NestJS?', a: 'Install @nestjs-redisx/rate-limit, add RateLimitPlugin, apply @RateLimit() to controllers, register RateLimitGuard.' },
        ],
      };
      const faq = FAQ[pageData.relativePath];
      if (faq) {
        head.push(['script', { type: 'application/ld+json' }, JSON.stringify({
          '@context': 'https://schema.org', '@type': 'FAQPage',
          mainEntity: faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
        })]);
      }

      return head;
    },

    locales: {
      root: {
        label: 'English',
        lang: 'en',
        link: '/en/',
      },
    },

    themeConfig: {
      logo: { src: '/icons/logo-flat-34x36.png', alt: 'NestJS RedisX' },
      siteTitle: 'NestJS RedisX',

      nav: [
        { text: 'Home', link: '/en/' },
        { text: 'Guide', link: '/en/guide/' },
        { text: 'Reference', link: '/en/reference/' },
        { text: 'v1.1.0', link: 'https://github.com/nestjs-redisx/nestjs-redisx/releases' },
      ],

      sidebar: {
        '/en/guide/': [
          {
            text: 'Getting Started',
            items: [
              { text: 'Introduction', link: '/en/guide/' },
              { text: 'Installation', link: '/en/guide/installation' },
              { text: 'Quick Start', link: '/en/guide/quick-start' },
              { text: 'Decision Guide', link: '/en/guide/decision-guide' },
            ],
          },
          {
            text: 'Concepts',
            collapsed: false,
            items: [
              { text: 'Overview', link: '/en/guide/concepts/' },
              { text: 'Two-Tier Caching', link: '/en/guide/concepts/two-tier-caching' },
              { text: 'Distributed Coordination', link: '/en/guide/concepts/distributed-coordination' },
              { text: 'Rate Limiting Strategies', link: '/en/guide/concepts/rate-limiting-strategies' },
              { text: 'Event Streaming', link: '/en/guide/concepts/event-streaming' },
              { text: 'Observability Strategy', link: '/en/guide/concepts/observability-strategy' },
            ],
          },
          {
            text: 'Architecture',
            collapsed: false,
            items: [
              { text: 'Overview', link: '/en/guide/architecture/' },
              { text: 'Key Naming', link: '/en/guide/architecture/key-naming' },
              { text: 'Multi-Tenancy', link: '/en/guide/architecture/multi-tenancy' },
              { text: 'Guarantees', link: '/en/guide/architecture/guarantees' },
              { text: 'Failure Modes', link: '/en/guide/architecture/failure-modes' },
              { text: 'Connection Management', link: '/en/guide/architecture/connection-management' },
              { text: 'Deployment', link: '/en/guide/architecture/deployment' },
              { text: 'Tuning', link: '/en/guide/architecture/tuning' },
              { text: 'Security', link: '/en/guide/architecture/security' },
            ],
          },
          {
            text: 'Recipes',
            collapsed: false,
            items: [
              { text: 'Overview', link: '/en/guide/recipes/' },
              { text: 'Payment Processing', link: '/en/guide/recipes/payment-processing' },
              { text: 'Webhook Delivery', link: '/en/guide/recipes/webhook-delivery' },
              { text: 'Login Throttling', link: '/en/guide/recipes/login-throttling' },
              { text: 'API Protection', link: '/en/guide/recipes/api-protection' },
              { text: 'Background Jobs', link: '/en/guide/recipes/background-jobs' },
              { text: 'Scheduled Tasks', link: '/en/guide/recipes/scheduled-tasks' },
              { text: 'CQRS Invalidation', link: '/en/guide/recipes/cqrs-invalidation' },
              { text: 'Session Management', link: '/en/guide/recipes/session-management' },
              { text: 'Example App', link: '/en/guide/recipes/example-app' },
            ],
          },
          {
            text: 'Integration',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/en/guide/integration/' },
              { text: 'From cache-manager', link: '/en/guide/integration/migration-cache-manager' },
              { text: 'From ioredis', link: '/en/guide/integration/migration-ioredis' },
              { text: 'NestJS Patterns', link: '/en/guide/integration/nestjs-patterns' },
              { text: 'Testing Strategy', link: '/en/guide/integration/testing-strategy' },
              { text: 'Prometheus & Grafana', link: '/en/guide/integration/prometheus-grafana' },
              { text: 'OpenTelemetry', link: '/en/guide/integration/opentelemetry' },
            ],
          },
          {
            text: 'Operations',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/en/guide/operations/' },
              { text: 'Monitoring', link: '/en/guide/operations/monitoring' },
              { text: 'Alerting', link: '/en/guide/operations/alerting' },
              { text: 'Capacity Planning', link: '/en/guide/operations/capacity-planning' },
              { text: 'Runbooks', link: '/en/guide/operations/runbooks' },
              { text: 'Testing', link: '/en/guide/operations/testing-overview' },
              { text: 'Compatibility', link: '/en/guide/operations/compatibility' },
            ],
          },
          {
            text: 'Troubleshooting',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/en/guide/troubleshooting/' },
              { text: 'Cache Issues', link: '/en/guide/troubleshooting/cache-issues' },
              { text: 'Lock Issues', link: '/en/guide/troubleshooting/lock-issues' },
              { text: 'Performance Issues', link: '/en/guide/troubleshooting/performance-issues' },
              { text: 'Debugging', link: '/en/guide/troubleshooting/debugging' },
            ],
          },
        ],

        '/en/reference/': [
          {
            text: 'Reference',
            items: [
              { text: 'Overview', link: '/en/reference/' },
            ],
          },
          {
            text: 'Core Module',
            collapsed: false,
            items: [
              { text: 'Overview', link: '/en/reference/core/' },
              { text: 'Configuration', link: '/en/reference/core/configuration' },
              { text: 'RedisService', link: '/en/reference/core/redis-service' },
              { text: 'Multiple Clients', link: '/en/reference/core/multiple-clients' },
              { text: 'Connection Types', link: '/en/reference/core/connection-types' },
              { text: 'Health Monitoring', link: '/en/reference/core/health-monitoring' },
              { text: 'Decorators', link: '/en/reference/core/decorators' },
              { text: 'Driver Abstraction', link: '/en/reference/core/driver-abstraction' },
              { text: 'Plugin System', link: '/en/reference/core/plugin-system' },
              { text: 'Error Handling', link: '/en/reference/core/error-handling' },
              { text: 'Troubleshooting', link: '/en/reference/core/troubleshooting' },
            ],
          },
          {
            text: 'Plugins',
            collapsed: false,
            items: [
              { text: 'Overview', link: '/en/reference/plugins/' },
            ],
          },
          {
            text: 'Cache',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/en/reference/cache/' },
              { text: 'Core Concepts', link: '/en/reference/cache/concepts' },
              { text: 'Configuration', link: '/en/reference/cache/configuration' },
              { text: 'Decorators', link: '/en/reference/cache/decorators' },
              { text: 'Service API', link: '/en/reference/cache/service-api' },
              { text: 'Tag Invalidation', link: '/en/reference/cache/tags' },
              { text: 'Anti-Stampede', link: '/en/reference/cache/stampede' },
              { text: 'Stale-While-Revalidate', link: '/en/reference/cache/swr' },
              { text: 'Cache Warming', link: '/en/reference/cache/warmup' },
              { text: 'Serializers', link: '/en/reference/cache/serializers' },
              { text: 'Eviction Strategies', link: '/en/reference/cache/strategies' },
              { text: 'Monitoring', link: '/en/reference/cache/monitoring' },
              { text: 'Testing', link: '/en/reference/cache/testing' },
              { text: 'Recipes', link: '/en/reference/cache/recipes' },
              { text: 'Troubleshooting', link: '/en/reference/cache/troubleshooting' },
            ],
          },
          {
            text: 'Locks',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/en/reference/locks/' },
              { text: 'Core Concepts', link: '/en/reference/locks/concepts' },
              { text: 'Configuration', link: '/en/reference/locks/configuration' },
              { text: '@WithLock Decorator', link: '/en/reference/locks/decorator' },
              { text: 'Service API', link: '/en/reference/locks/service-api' },
              { text: 'Auto-Renewal', link: '/en/reference/locks/auto-renewal' },
              { text: 'Retry Strategies', link: '/en/reference/locks/retry-strategies' },
              { text: 'Patterns', link: '/en/reference/locks/patterns' },
              { text: 'Monitoring', link: '/en/reference/locks/monitoring' },
              { text: 'Testing', link: '/en/reference/locks/testing' },
              { text: 'Recipes', link: '/en/reference/locks/recipes' },
              { text: 'Troubleshooting', link: '/en/reference/locks/troubleshooting' },
            ],
          },
          {
            text: 'Rate Limit',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/en/reference/rate-limit/' },
              { text: 'Core Concepts', link: '/en/reference/rate-limit/concepts' },
              { text: 'Configuration', link: '/en/reference/rate-limit/configuration' },
              { text: '@RateLimit Decorator', link: '/en/reference/rate-limit/decorator' },
              { text: 'RateLimitGuard', link: '/en/reference/rate-limit/guard' },
              { text: 'Service API', link: '/en/reference/rate-limit/service-api' },
              { text: 'Algorithms', link: '/en/reference/rate-limit/algorithms' },
              { text: 'Key Extraction', link: '/en/reference/rate-limit/key-extraction' },
              { text: 'Response Headers', link: '/en/reference/rate-limit/headers' },
              { text: 'Monitoring', link: '/en/reference/rate-limit/monitoring' },
              { text: 'Testing', link: '/en/reference/rate-limit/testing' },
              { text: 'Recipes', link: '/en/reference/rate-limit/recipes' },
              { text: 'Troubleshooting', link: '/en/reference/rate-limit/troubleshooting' },
            ],
          },
          {
            text: 'Idempotency',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/en/reference/idempotency/' },
              { text: 'Core Concepts', link: '/en/reference/idempotency/concepts' },
              { text: 'Configuration', link: '/en/reference/idempotency/configuration' },
              { text: '@Idempotent Decorator', link: '/en/reference/idempotency/decorator' },
              { text: 'Service API', link: '/en/reference/idempotency/service-api' },
              { text: 'Fingerprinting', link: '/en/reference/idempotency/fingerprinting' },
              { text: 'Concurrent Requests', link: '/en/reference/idempotency/concurrent-requests' },
              { text: 'Header Caching', link: '/en/reference/idempotency/headers' },
              { text: 'Client Guide', link: '/en/reference/idempotency/client-guide' },
              { text: 'Monitoring', link: '/en/reference/idempotency/monitoring' },
              { text: 'Testing', link: '/en/reference/idempotency/testing' },
              { text: 'Recipes', link: '/en/reference/idempotency/recipes' },
              { text: 'Troubleshooting', link: '/en/reference/idempotency/troubleshooting' },
            ],
          },
          {
            text: 'Streams',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/en/reference/streams/' },
              { text: 'Core Concepts', link: '/en/reference/streams/concepts' },
              { text: 'Configuration', link: '/en/reference/streams/configuration' },
              { text: 'Producer API', link: '/en/reference/streams/producer' },
              { text: 'Consumer API', link: '/en/reference/streams/consumer' },
              { text: 'Consumer Groups', link: '/en/reference/streams/consumer-groups' },
              { text: 'Dead Letter Queue', link: '/en/reference/streams/dead-letter-queue' },
              { text: 'Message Handling', link: '/en/reference/streams/message-handling' },
              { text: 'Backpressure', link: '/en/reference/streams/backpressure' },
              { text: 'Patterns', link: '/en/reference/streams/patterns' },
              { text: 'Monitoring', link: '/en/reference/streams/monitoring' },
              { text: 'Testing', link: '/en/reference/streams/testing' },
              { text: 'Recipes', link: '/en/reference/streams/recipes' },
              { text: 'Troubleshooting', link: '/en/reference/streams/troubleshooting' },
            ],
          },
          {
            text: 'Metrics',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/en/reference/metrics/' },
              { text: 'Core Concepts', link: '/en/reference/metrics/concepts' },
              { text: 'Configuration', link: '/en/reference/metrics/configuration' },
              { text: 'Prometheus', link: '/en/reference/metrics/prometheus' },
              { text: 'Grafana Dashboards', link: '/en/reference/metrics/grafana' },
              { text: 'Plugin Metrics', link: '/en/reference/metrics/plugin-metrics' },
              { text: 'Custom Metrics', link: '/en/reference/metrics/custom-metrics' },
              { text: 'Alerting', link: '/en/reference/metrics/alerting' },
              { text: 'Testing', link: '/en/reference/metrics/testing' },
              { text: 'Recipes', link: '/en/reference/metrics/recipes' },
              { text: 'Troubleshooting', link: '/en/reference/metrics/troubleshooting' },
            ],
          },
          {
            text: 'Tracing',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/en/reference/tracing/' },
              { text: 'Core Concepts', link: '/en/reference/tracing/concepts' },
              { text: 'Configuration', link: '/en/reference/tracing/configuration' },
              { text: 'OpenTelemetry', link: '/en/reference/tracing/opentelemetry' },
              { text: 'Exporters', link: '/en/reference/tracing/exporters' },
              { text: 'Spans', link: '/en/reference/tracing/spans' },
              { text: 'Plugin Tracing', link: '/en/reference/tracing/plugin-tracing' },
              { text: 'Sampling', link: '/en/reference/tracing/sampling' },
              { text: 'Visualization', link: '/en/reference/tracing/visualization' },
              { text: 'Testing', link: '/en/reference/tracing/testing' },
              { text: 'Recipes', link: '/en/reference/tracing/recipes' },
              { text: 'Troubleshooting', link: '/en/reference/tracing/troubleshooting' },
            ],
          },
        ],
      },

      socialLinks: [
        { icon: 'github', link: 'https://github.com/nestjs-redisx/nestjs-redisx' },
        { icon: 'npm', link: 'https://www.npmjs.com/package/@nestjs-redisx/core' },
      ],

      footer: {
        message: 'Released under the MIT License.',
        copyright: '© 2025 NestJS RedisX',
      },

      search: {
        provider: 'local',
      },

      outline: {
        level: [2, 3],
        label: 'On this page',
      },

      editLink: {
        pattern: 'https://github.com/nestjs-redisx/nestjs-redisx/edit/main/website/:path',
        text: 'Edit this page on GitHub',
      },

      lastUpdated: {
        text: 'Last updated',
        formatOptions: {
          dateStyle: 'medium',
        },
      },
    },

    markdown: {
      theme: {
        light: 'github-light',
        dark: 'github-dark',
      },
      lineNumbers: true,
      config: (md) => {
        // VitePress resolves <<< @/ to srcDir (website/) during parsing.
        // Rewrite resolved paths so @/apps/... points to repo root apps/.
        const srcDirAbs = resolve(repoRoot, 'website');
        const fence = md.renderer.rules.fence!;
        md.renderer.rules.fence = (...args) => {
          const token = args[0][args[1]];
          if (token.src?.[0]?.startsWith(srcDirAbs + '/apps/')) {
            token.src[0] = repoRoot + token.src[0].slice(srcDirAbs.length);
          }
          return fence(...args);
        };
      },
    },

    mermaid: {
      theme: 'base',
    },

    mermaidPlugin: {
      class: 'mermaid',
    },

    lastUpdated: true,
  }),
);
