// Shared type stubs for session plugin demo snippets

// Application module stub (snippets bootstrap it in main.ts examples)
export class AppModule {}

// Application session payload shape (compile-time contract)
export interface AppSession {
  cookie: unknown;
  passport?: { user?: string };
  cart?: string[];
  theme?: 'light' | 'dark';
}

// Abstract dependencies (stubs for DI in snippets)
export abstract class AuditLog {
  abstract record(entry: { action: string; sessionId: string; userId?: string }): void;
}
