import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import { SESSION_STORE, toFastifyStore } from '@nestjs-redisx/session';
import type { ISessionStore } from '@nestjs-redisx/session';

import { AppModule } from './types';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

  const store = app.get<ISessionStore>(SESSION_STORE);
  await app.register(fastifyCookie);
  await app.register(fastifySession, {
    secret: process.env.SESSION_SECRET ?? 'a secret with minimum length of 32 characters',
    cookie: { secure: 'auto', maxAge: 3600_000 },
    saveUninitialized: false,
    store: toFastifyStore(store),
  });

  await app.listen(3000, '0.0.0.0');
}

void bootstrap();
