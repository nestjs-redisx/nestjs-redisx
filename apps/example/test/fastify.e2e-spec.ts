import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as request from 'supertest';
import Redis from 'ioredis';
import { AppModule } from './../src/app.module';

/**
 * End-to-end tests for the rate-limit and idempotency plugins running on the
 * Fastify adapter. Mirrors express.e2e-spec.ts to catch divergence between the
 * two HTTP adapters.
 */
describe('Rate limit + idempotency (Fastify)', () => {
  let app: NestFastifyApplication;

  const redisHost = process.env.REDIS_HOST || 'localhost';
  const redisPort = Number(process.env.REDIS_PORT || 6379);

  beforeAll(async () => {
    const flusher = new Redis({ host: redisHost, port: redisPort, lazyConnect: true });
    await flusher.connect();
    await flusher.flushdb();
    await flusher.quit();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 60_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('returns rate limit headers on allowed requests', async () => {
    const res = await request(app.getHttpServer()).get('/demo/rate-limit/public');

    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe('10');
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    expect(res.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('returns 429 with structured body when limit is exceeded', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer()).get('/demo/rate-limit/public');
    }

    const res = await request(app.getHttpServer()).get('/demo/rate-limit/public');

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.body).toEqual(
      expect.objectContaining({
        statusCode: 429,
        message: expect.any(String),
        error: 'Too Many Requests',
        retryAfter: expect.any(Number),
        limit: 10,
        remaining: expect.any(Number),
        reset: expect.any(Number),
      }),
    );
  });

  it('replays identical idempotent response for repeated requests', async () => {
    const key = `e2e-fastify-${Date.now()}-replay`;
    const body = { amount: 100, currency: 'USD', customerId: 'cust_replay' };

    const first = await request(app.getHttpServer())
      .post('/demo/idempotency/payment')
      .set('Idempotency-Key', key)
      .send(body);

    const second = await request(app.getHttpServer())
      .post('/demo/idempotency/payment')
      .set('Idempotency-Key', key)
      .send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it('errors when the same key is reused with a different body', async () => {
    const key = `e2e-fastify-${Date.now()}-mismatch`;

    const first = await request(app.getHttpServer())
      .post('/demo/idempotency/payment')
      .set('Idempotency-Key', key)
      .send({ amount: 100, currency: 'USD', customerId: 'cust_mm' });

    expect(first.status).toBe(200);

    const mismatch = await request(app.getHttpServer())
      .post('/demo/idempotency/payment')
      .set('Idempotency-Key', key)
      .send({ amount: 200, currency: 'USD', customerId: 'cust_mm' });

    expect(mismatch.status).toBeGreaterThanOrEqual(400);
  });

  it('skips idempotency when no key is provided', async () => {
    const res = await request(app.getHttpServer())
      .post('/demo/idempotency/payment')
      .send({ amount: 50, currency: 'USD', customerId: 'cust_nokey' });

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });
});
