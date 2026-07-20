// Shared type stubs for circuit-breaker plugin demo snippets

export interface Charge {
  id: string;
  amount: number;
}

export interface User {
  id: string;
  name: string;
}

// Abstract external dependencies (stubs for DI in snippets)
export abstract class PaymentGateway {
  abstract charge(charge: Charge): Promise<{ ok: boolean }>;
}

export abstract class UsersApi {
  abstract getUser(id: string): Promise<User>;
}

export abstract class UserCache {
  abstract get(id: string): Promise<User | null>;
}
