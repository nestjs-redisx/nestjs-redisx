export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

export interface SessionData {
  userId: string;
  ip?: string;
  userAgent?: string;
}

export interface Session {
  id: string;
  userId: string;
  data: SessionData;
}

export interface Job {
  id: string;
  type: string;
  payload: unknown;
}

export declare function generateSessionId(): string;
