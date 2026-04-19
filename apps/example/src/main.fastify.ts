/**
 * @fileoverview Application entry point for the Fastify HTTP adapter.
 *
 * Mirrors main.ts but bootstraps NestJS with FastifyAdapter instead of Express.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: ['error', 'warn', 'log', 'debug', 'verbose'] },
  );

  app.enableShutdownHooks();

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');

  logger.log(`Application running on: http://localhost:${port} (fastify)`);
  logger.log(`Metrics: http://localhost:${port}/metrics`);
  logger.log(`Health: http://localhost:${port}/demo/core/health`);
}

bootstrap();
