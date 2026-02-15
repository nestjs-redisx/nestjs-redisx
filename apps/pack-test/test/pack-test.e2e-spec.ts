import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { RedisService } from '@nestjs-redisx/core';
import { TracingPlugin } from '@nestjs-redisx/tracing';

describe('Pack Test E2E', () => {
  let app: INestApplication;
  let redisService: RedisService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    redisService = moduleRef.get(RedisService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('App Bootstrap', () => {
    it('should boot without errors', () => {
      expect(app).toBeDefined();
    });

    it('GET /health — returns ok', async () => {
      const res = await request(app.getHttpServer()).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });
  });

  describe('Cache Plugin', () => {
    it('GET /cache/:key — first call returns fresh data', async () => {
      const res = await request(app.getHttpServer()).get('/cache/test-key');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('key', 'test-key');
      expect(res.body).toHaveProperty('value', 'data-test-key');
      expect(res.body).toHaveProperty('timestamp');
    });

    it('GET /cache/:key — second call returns cached data (same timestamp)', async () => {
      const res1 = await request(app.getHttpServer()).get('/cache/cached-key');
      const res2 = await request(app.getHttpServer()).get('/cache/cached-key');
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res2.body.timestamp).toBe(res1.body.timestamp);
    });

    it('POST /cache/invalidate — invalidates tags', async () => {
      const res = await request(app.getHttpServer())
        .post('/cache/invalidate')
        .send({ tags: ['test'] });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ invalidated: true });
    });
  });

  describe('Locks Plugin', () => {
    it('GET /lock-test — acquires lock and returns', async () => {
      const res = await request(app.getHttpServer()).get('/lock-test');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('locked', true);
      expect(res.body).toHaveProperty('timestamp');
    });

    it('GET /lock-test — concurrent requests serialize correctly', async () => {
      const results = await Promise.all([
        request(app.getHttpServer()).get('/lock-test'),
        request(app.getHttpServer()).get('/lock-test'),
      ]);

      expect(results[0].status).toBe(200);
      expect(results[1].status).toBe(200);

      const t1 = results[0].body.timestamp;
      const t2 = results[1].body.timestamp;
      // Timestamps should differ by at least ~100ms (the sleep duration)
      expect(Math.abs(t1 - t2)).toBeGreaterThanOrEqual(50);
    });
  });

  describe('Rate Limit Plugin', () => {
    beforeEach(async () => {
      // Clear rate limit keys
      const client = await redisService.getClient();
      const keys = await client.keys('rl:*');
      if (keys.length > 0) {
        await client.del(...keys);
      }
    });

    it('GET /rate-limited — allows requests within limit', async () => {
      const res = await request(app.getHttpServer()).get('/rate-limited');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ allowed: true });
    });

    it('GET /rate-limited — 6th request returns 429', async () => {
      // Send 5 allowed requests
      for (let i = 0; i < 5; i++) {
        const res = await request(app.getHttpServer()).get('/rate-limited');
        expect(res.status).toBe(200);
      }

      // 6th should be rate-limited
      const res = await request(app.getHttpServer()).get('/rate-limited');
      expect(res.status).toBe(429);
    });
  });

  describe('Idempotency Plugin', () => {
    it('POST /idempotent — same Idempotency-Key returns same response', async () => {
      const idempotencyKey = `test-${Date.now()}`;

      const res1 = await request(app.getHttpServer())
        .post('/idempotent')
        .set('Idempotency-Key', idempotencyKey)
        .send({});

      const res2 = await request(app.getHttpServer())
        .post('/idempotent')
        .set('Idempotency-Key', idempotencyKey)
        .send({});

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res1.body.id).toBe(res2.body.id);
    });
  });

  describe('Streams Plugin', () => {
    it('POST /stream/publish — publishes message successfully', async () => {
      const res = await request(app.getHttpServer())
        .post('/stream/publish')
        .send({ message: 'hello from pack test' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('streamId');
      expect(typeof res.body.streamId).toBe('string');

      // Verify stream entry exists via RedisService
      const client = await redisService.getClient();
      const len = await client.xlen('pack-test-stream');
      expect(len).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Tracing Plugin', () => {
    it('TracingPlugin import resolves from tarball', () => {
      expect(TracingPlugin).toBeDefined();
      expect(typeof TracingPlugin).toBe('function');
    });
  });

  describe('Metrics Plugin', () => {
    it('GET /metrics — returns Prometheus metrics with redisx_ prefix', async () => {
      const res = await request(app.getHttpServer()).get('/metrics');
      expect(res.status).toBe(200);
      expect(typeof res.text).toBe('string');
      expect(res.text).toContain('redisx_');
    });
  });
});
