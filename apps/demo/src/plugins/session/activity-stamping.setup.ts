import { NestFactory } from '@nestjs/core';
import { SESSION_SERVICE } from '@nestjs-redisx/session';
import type { ISessionService } from '@nestjs-redisx/session';

import { AppModule } from './types';

interface SessionRequest {
  sessionID: string;
  session?: { passport?: { user?: string } };
  ip: string;
  get(header: string): string | undefined;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const sessions = app.get<ISessionService>(SESSION_SERVICE);

  // Opt-in metadata stamping AFTER the session middleware: gives the device
  // page its IP and user-agent columns. Fire-and-forget — never blocks.
  app.use((req: SessionRequest, _res: unknown, next: () => void) => {
    if (req.session?.passport?.user) {
      void sessions.recordActivity(req.sessionID, { ip: req.ip, userAgent: req.get('user-agent') }).catch(() => undefined);
    }
    next();
  });

  await app.listen(3000);
}

void bootstrap();
