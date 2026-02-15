// Shared type stubs for metrics plugin demo snippets

// Domain entities
export interface Order {
  id: string;
  total: number;
  status: string;
  paymentMethod: string;
  shippingAddress: {
    country: string;
  };
}

export interface Payment {
  id: string;
  amount: number;
  provider: string;
}

export interface Job {
  id: string;
  type: string;
  data: unknown;
}

// DTOs
export interface CreateOrderDto {
  productId: string;
  quantity: number;
  paymentMethod: string;
}

export interface PaymentDto {
  amount: number;
  provider: string;
}

// Abstract service stubs for DI
export abstract class OrderRepo {
  abstract create(dto: CreateOrderDto): Promise<Order>;
}

export abstract class PaymentGateway {
  abstract charge(dto: PaymentDto): Promise<Payment>;
}

export abstract class RedisClient {
  abstract llen(key: string): Promise<number>;
}
