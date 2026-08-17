/**
 * @fileoverview Demo module for @nestjs-redisx/session.
 *
 * Wires real express-session middleware (backed by the plugin's SESSION_STORE
 * via toExpressStore) onto the demo/session routes, so the login flow, device
 * page, and revocation endpoints run against the same store as production.
 */

import { Inject, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import * as session from 'express-session';
import { SESSION_STORE, toExpressStore, type ISessionStore } from '@nestjs-redisx/session';
import type { RequestHandler } from 'express';

import { SessionDemoController } from './session-demo.controller';
import { SessionDemoService } from './session-demo.service';

const SESSION_MIDDLEWARE = Symbol('SESSION_MIDDLEWARE');

@Module({
  controllers: [SessionDemoController],
  providers: [
    SessionDemoService,
    {
      provide: SESSION_MIDDLEWARE,
      useFactory: async (store: ISessionStore): Promise<RequestHandler> =>
        session({
          secret: process.env.SESSION_SECRET || 'example-secret-change-me',
          resave: false,
          saveUninitialized: false,
          rolling: true,
          cookie: { maxAge: 3600_000, httpOnly: true, secure: false },
          store: await toExpressStore(store),
        }),
      inject: [SESSION_STORE],
    },
  ],
})
export class SessionDemoModule implements NestModule {
  constructor(
    @Inject(SESSION_MIDDLEWARE)
    private readonly sessionMiddleware: RequestHandler,
  ) {}

  configure(consumer: MiddlewareConsumer): void {
    // express-session applies only to the session demo routes: the rest of the
    // example app (including the fastify entrypoint) is unaffected.
    consumer.apply(this.sessionMiddleware).forRoutes('demo/session');
  }
}
