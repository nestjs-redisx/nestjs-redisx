import { Injectable, Inject } from '@nestjs/common';
import { SESSION_SERVICE } from '@nestjs-redisx/session';
import type { ISessionService } from '@nestjs-redisx/session';

import { AppSession } from './types';

// req.session typing stays middleware-owned — extend it via declaration
// merging (compile-time only; session contents are not validated at runtime):
//
// declare module 'express-session' {
//   interface SessionData extends AppSession {}
// }

@Injectable()
export class TypedSessionService {
  constructor(
    // Our API is genuinely typed: pass your payload shape as the generic.
    @Inject(SESSION_SERVICE) private readonly sessions: ISessionService<AppSession>,
  ) {}

  async cartOf(sessionId: string): Promise<string[]> {
    const info = await this.sessions.getSession(sessionId);
    return info?.data.cart ?? []; // data is AppSession, not unknown
  }
}
