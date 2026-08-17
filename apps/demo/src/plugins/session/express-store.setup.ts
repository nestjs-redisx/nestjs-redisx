import { NestFactory } from '@nestjs/core';
import session from 'express-session';
import { SESSION_STORE, toExpressStore } from '@nestjs-redisx/session';
import type { ISessionStore } from '@nestjs-redisx/session';

import { AppModule } from './types';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // One line replaces connect-redis — passport and req.session keep working.
  const store = app.get<ISessionStore>(SESSION_STORE);
  app.use(
    session({
      secret: process.env.SESSION_SECRET ?? 'change-me',
      resave: false,
      saveUninitialized: false,
      rolling: true, // slide the TTL on every request
      cookie: { maxAge: 3600_000, httpOnly: true },
      store: await toExpressStore(store),
    }),
  );

  await app.listen(3000);
}

void bootstrap();
