// Shared type stubs for rate-limit plugin demo snippets

import { HttpException, HttpStatus } from '@nestjs/common';

// NestJS 10 doesn't have TooManyRequestsException, so we provide a stub
export class TooManyRequestsException extends HttpException {
  constructor(message?: string) {
    super(message || 'Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
  }
}

// Domain entities
export interface User {
  id: string;
  email: string;
  tier: string;
  plan?: string;
  role?: string;
  organizationId?: string;
  createdAt: Date;
}

export interface WebhookPayload {
  event: string;
  data: unknown;
}

// Abstract service stubs for DI
export abstract class UserService {
  abstract findOne(id: string): Promise<User>;
  abstract upgrade(id: string): Promise<void>;
}

export abstract class AuthService {
  abstract validateUser(email: string, password: string): Promise<User | null>;
  abstract login(user: User): Promise<{ accessToken: string }>;
  abstract sendResetEmail(email: string): Promise<void>;
}

export abstract class Mailer {
  abstract send(params: { to: string; subject: string }): Promise<void>;
}

export abstract class EmailQueue {
  abstract add(data: any, options?: { delay: number }): Promise<void>;
}

export abstract class HttpClient {
  abstract post(url: string, payload: any): Promise<void>;
}
