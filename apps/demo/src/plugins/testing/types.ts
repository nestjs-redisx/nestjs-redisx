// Shared type stubs for the testing-utilities demo snippets.

export interface User {
  id: number;
  name: string;
}

// Abstract repository stub for DI in examples.
export abstract class UserRepo {
  abstract findById(id: number): Promise<User>;
}
