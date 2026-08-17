import { describe, it, expect, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import Fastify, { type FastifyInstance } from 'fastify';
import request from 'supertest';

import { SessionPlugin, SESSION_SERVICE, SESSION_STORE, toFastifyStore, type ISessionService, type ISessionStore, type ISessionPluginOptions } from '../../src';

/**
 * E2E against REAL @fastify/session middleware and a LIVE Redis instance on
 * REDIS_HOST:REDIS_PORT (defaults to localhost:6379). Skipped when
 * SKIP_INTEGRATION=true.
 *
 * Mirrors the express-session e2e so divergence between the two adapters is
 * caught: login -> device page -> revokeAllExcept -> old cookie rejected.
 */
const skipIntegration = process.env.SKIP_INTEGRATION === 'true';
const describeIntegration = skipIntegration ? describe.skip : describe;

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

interface IFastifySessionShape {
  sessionId: string;
  passport?: { user?: string };
  destroy(): Promise<void>;
}

describeIntegration('Session e2e (@fastify/session, live Redis)', () => {
  let app: TestingModule | undefined;
  let web: FastifyInstance | undefined;
  let n = 0;
  const uniquePrefix = (): string => `sess-e2e-f:${process.pid}:${Date.now()}:${n++}:`;

  interface IBooted {
    web: FastifyInstance;
    service: ISessionService;
  }

  async function boot(options: Omit<ISessionPluginOptions, 'keyPrefix'> = {}): Promise<IBooted> {
    app = await Test.createTestingModule({
      imports: [
        RedisModule.forRoot({
          clients: { type: 'single', host: REDIS_HOST, port: REDIS_PORT },
          plugins: [new SessionPlugin({ ...options, keyPrefix: uniquePrefix() })],
        }),
      ],
    }).compile();
    await app.init();

    const store = app.get<ISessionStore>(SESSION_STORE);
    const service = app.get<ISessionService>(SESSION_SERVICE);

    web = Fastify();
    await web.register(fastifyCookie);
    await web.register(fastifySession, {
      secret: 'an e2e secret with minimum length of 32 characters',
      cookie: { secure: false, maxAge: 60_000 },
      saveUninitialized: false,
      store: toFastifyStore(store),
    });

    web.post('/login/:userId', async (req, reply) => {
      const sessionUser = (req.params as { userId: string }).userId;
      const session = req.session as unknown as IFastifySessionShape;
      session.passport = { user: sessionUser };
      await reply.send({ sid: session.sessionId });
    });

    web.get('/me', async (req, reply) => {
      const session = req.session as unknown as IFastifySessionShape;
      const userId = session.passport?.user;
      if (!userId) {
        await reply.status(401).send({ error: 'unauthenticated' });
        return;
      }
      await reply.send({ userId, sid: session.sessionId });
    });

    web.post('/logout-others', async (req, reply) => {
      const session = req.session as unknown as IFastifySessionShape;
      const userId = session.passport?.user;
      if (!userId) {
        await reply.status(401).send({ error: 'unauthenticated' });
        return;
      }
      const revoked = await service.revokeAllExcept(userId, session.sessionId);
      await reply.send({ revoked });
    });

    web.post('/logout', async (req, reply) => {
      const session = req.session as unknown as IFastifySessionShape;
      await session.destroy();
      await reply.send({ ok: true });
    });

    await web.ready();
    return { web, service };
  }

  afterEach(async () => {
    await web?.close();
    web = undefined;
    await app?.close();
    app = undefined;
  });

  it('runs login -> device page -> logout-others -> old cookie rejected', async () => {
    // Given two logged-in devices
    const { web: server, service } = await boot();
    const laptop = request.agent(server.server);
    const phone = request.agent(server.server);
    await laptop.post('/login/user-1').expect(200);
    const phoneLogin = await phone.post('/login/user-1').expect(200);

    // When: the device page is built from the service
    const devices = await service.getSessionsByUser('user-1');

    // Then
    expect(devices).toHaveLength(2);
    expect(devices.every((d) => d.metadata?.userId === 'user-1')).toBe(true);

    // When: "log out everywhere else" from the phone
    const response = await phone.post('/logout-others').expect(200);

    // Then
    expect(response.body.revoked).toBe(1);
    await laptop.get('/me').expect(401);
    await phone.get('/me').expect(200);
    expect(await service.countByUser('user-1')).toBe(1);
    void phoneLogin;
  });

  it('destroys the session on logout', async () => {
    // Given
    const { web: server, service } = await boot();
    const browser = request.agent(server.server);
    await browser.post('/login/user-2').expect(200);
    await browser.get('/me').expect(200);

    // When
    await browser.post('/logout').expect(200);

    // Then
    await browser.get('/me').expect(401);
    expect(await service.countByUser('user-2')).toBe(0);
  });
});
