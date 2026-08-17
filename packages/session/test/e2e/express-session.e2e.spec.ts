import { describe, it, expect, afterEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { RedisModule } from '@nestjs-redisx/core';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import request from 'supertest';

import { SessionPlugin, SESSION_SERVICE, SESSION_STORE, SessionLimitExceededError, toExpressStore, type ISessionService, type ISessionStore, type ISessionPluginOptions } from '../../src';

/**
 * E2E against REAL express-session middleware and a LIVE Redis instance on
 * REDIS_HOST:REDIS_PORT (defaults to localhost:6379). Skipped when
 * SKIP_INTEGRATION=true.
 *
 * Login mimics passport's req.logIn: regenerate (fixation defense) +
 * `session.passport.user` + explicit save — so the default userIdExtractor
 * and the "old cookie rejected" flows are exercised exactly as in production.
 */
const skipIntegration = process.env.SKIP_INTEGRATION === 'true';
const describeIntegration = skipIntegration ? describe.skip : describe;

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// The documented typing pattern: `req.session` stays middleware-owned,
// application fields are added via declaration merging.
declare module 'express-session' {
  interface SessionData {
    passport?: { user?: string };
  }
}

describeIntegration('Session e2e (express-session, live Redis)', () => {
  let app: TestingModule | undefined;
  let n = 0;
  const uniquePrefix = (): string => `sess-e2e:${process.pid}:${Date.now()}:${n++}:`;

  interface IBooted {
    web: Express;
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

    const web = express();
    web.use(
      session({
        secret: 'e2e secret',
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: { maxAge: 60_000, secure: false },
        store: await toExpressStore(store),
      }),
    );

    // Opt-in activity stamping: one line after the session middleware.
    web.use((req: Request, _res: Response, next: NextFunction) => {
      if (req.session.passport?.user) {
        void service.recordActivity(req.sessionID, { ip: req.ip, userAgent: req.get('user-agent') }).catch(() => undefined);
      }
      next();
    });

    // Passport-style login: regenerate + stamp + explicit save (req.logIn shape).
    web.post('/login/:userId', (req: Request, res: Response, next: NextFunction) => {
      req.session.regenerate((regenerateError) => {
        if (regenerateError) {
          next(regenerateError);
          return;
        }
        req.session.passport = { user: req.params.userId };
        req.session.save((saveError) => {
          if (saveError) {
            next(saveError);
            return;
          }
          res.json({ sid: req.sessionID });
        });
      });
    });

    web.get('/me', (req: Request, res: Response) => {
      const userId = req.session.passport?.user;
      if (!userId) {
        res.status(401).json({ error: 'unauthenticated' });
        return;
      }
      res.json({ userId, sid: req.sessionID });
    });

    web.get('/devices', (req: Request, res: Response, next: NextFunction) => {
      const userId = req.session.passport?.user;
      if (!userId) {
        res.status(401).json({ error: 'unauthenticated' });
        return;
      }
      service
        .getSessionsByUser(userId)
        .then((sessions) => res.json(sessions))
        .catch(next);
    });

    web.post('/logout-others', (req: Request, res: Response, next: NextFunction) => {
      const userId = req.session.passport?.user;
      if (!userId) {
        res.status(401).json({ error: 'unauthenticated' });
        return;
      }
      service
        .revokeAllExcept(userId, req.sessionID)
        .then((revoked) => res.json({ revoked }))
        .catch(next);
    });

    // Seat-limit rejections surface here (through the save callback).
    web.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof SessionLimitExceededError) {
        res.status(409).json({ error: 'session-limit' });
        return;
      }
      res.status(500).json({ error: (error as Error).message });
    });

    return { web, service };
  }

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('runs the full device-page flow: login -> list -> logout-others -> old cookie rejected', async () => {
    // Given two logged-in devices
    const { web } = await boot();
    const laptop = request.agent(web);
    const phone = request.agent(web);

    const laptopLogin = await laptop.post('/login/user-1').set('User-Agent', 'Laptop UA');
    expect(laptopLogin.status).toBe(200);
    await phone.post('/login/user-1').set('User-Agent', 'Phone UA').expect(200);

    // Activity stamping runs before the route handler, so the login request
    // itself is not yet authenticated — any later request stamps the metadata.
    await laptop.get('/me').set('User-Agent', 'Laptop UA').expect(200);

    // When: the device page is read from the phone
    const devices = await phone.get('/devices').set('User-Agent', 'Phone UA').expect(200);

    // Then: both sessions are listed with stamped metadata
    expect(devices.body).toHaveLength(2);
    await vi.waitFor(async () => {
      const refreshed = await phone.get('/devices').set('User-Agent', 'Phone UA').expect(200);
      const agents = (refreshed.body as Array<{ metadata: { userAgent?: string } | null }>).map((d) => d.metadata?.userAgent).sort();
      expect(agents).toEqual(['Laptop UA', 'Phone UA']);
    });

    // When: "log out everywhere else" is pressed on the phone
    const logoutOthers = await phone.post('/logout-others').set('User-Agent', 'Phone UA').expect(200);

    // Then: exactly one session is revoked, the laptop cookie is rejected, the phone stays in
    expect(logoutOthers.body.revoked).toBe(1);
    await laptop.get('/me').expect(401);
    await phone.get('/me').set('User-Agent', 'Phone UA').expect(200);
  });

  it('rejects a revoked cookie after an admin-side revoke', async () => {
    // Given
    const { web, service } = await boot();
    const browser = request.agent(web);
    const login = await browser.post('/login/user-2').expect(200);
    await browser.get('/me').expect(200);

    // When: support revokes the session by ID
    const revoked = await service.revoke(login.body.sid as string);

    // Then
    expect(revoked).toBe(true);
    await browser.get('/me').expect(401);
  });

  it('surfaces the seat-limit rejection as an HTTP error through the save callback', async () => {
    // Given a 1-seat limit with the reject policy
    const { web } = await boot({ maxSessionsPerUser: 1, maxSessionsPolicy: 'reject' });
    const first = request.agent(web);
    const second = request.agent(web);
    await first.post('/login/user-3').expect(200);

    // When / Then: the second device cannot log in, the first keeps working
    await second.post('/login/user-3').expect(409);
    await first.get('/me').expect(200);
    await second.get('/me').expect(401);
  });

  it('slides lastSeenAt via the middleware touch on unmodified requests', async () => {
    // Given
    const { web, service } = await boot();
    const browser = request.agent(web);
    const login = await browser.post('/login/user-4').expect(200);
    const sid = login.body.sid as string;
    const before = await service.getSession(sid);

    // When
    await wait(25);
    await browser.get('/me').expect(200);

    // Then
    await vi.waitFor(async () => {
      const after = await service.getSession(sid);
      expect(after!.metadata!.lastSeenAt).toBeGreaterThan(before!.metadata!.lastSeenAt);
    });
  });
});
