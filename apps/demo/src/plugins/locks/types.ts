// Shared type stubs for locks plugin demo snippets

// Domain entities
export interface Payment {
  id: string;
  amount: number;
  orderId: string;
}

export interface Order {
  id: string;
  amount: number;
  status: string;
  paid?: boolean;
  paymentId?: string;
}

export interface Job {
  id: string;
  data: unknown;
}

export interface Data {
  id: string;
  value: unknown;
}

// Error stubs
export class PaymentAlreadyProcessedError extends Error {
  constructor(orderId: string) {
    super(`Payment already processed for order ${orderId}`);
  }
}

// Abstract service stubs for DI
export abstract class OrderRepository {
  abstract findById(id: string): Promise<Order>;
  abstract findOne(id: string): Promise<Order>;
  abstract update(id: string, data: Partial<Order>): Promise<void>;
  abstract markPaid(id: string): Promise<void>;
}

export abstract class PaymentGateway {
  abstract charge(input: any): Promise<Payment>;
}

export abstract class InventoryStore {
  abstract getStock(sku: string): Promise<number>;
  abstract decrement(sku: string, quantity: number): Promise<void>;
}

export abstract class ExternalApiClient {
  abstract fetchProducts(): Promise<unknown[]>;
  abstract call(): Promise<Data>;
}

export abstract class Database {
  abstract bulkUpsert(items: unknown[]): Promise<void>;
}

export abstract class JobQueue {
  abstract peek(): Promise<Job | null>;
  abstract complete(id: string): Promise<void>;
}
