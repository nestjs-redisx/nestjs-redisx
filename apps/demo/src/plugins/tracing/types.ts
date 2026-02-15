// Shared type stubs for tracing plugin demo snippets

// Domain entities
export interface User {
  id: string;
  email: string;
  password?: string;
  role?: string;
}

export interface Order {
  id: string;
  total: number;
  items: OrderItem[];
  customerId: string;
  paymentMethod: string;
  status: string;
}

export interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

export interface CreateOrderDto {
  total: number;
  items: OrderItem[];
  customerId: string;
  paymentMethod: string;
}

export interface RegisterDto {
  email: string;
  password: string;
}

// Abstract service stubs for DI
export abstract class UserRepository {
  abstract findById(id: string): Promise<User>;
  abstract findByEmail(email: string): Promise<User | null>;
  abstract findAll(): Promise<User[]>;
  abstract create(data: Partial<User>): Promise<User>;
}

export abstract class OrderRepository {
  abstract create(dto: CreateOrderDto): Promise<Order>;
}

export abstract class PaymentService {
  abstract charge(orderId: string, amount: number): Promise<void>;
}

export abstract class EmailService {
  abstract sendWelcome(email: string): Promise<void>;
}

export abstract class CacheStore {
  abstract get(key: string): Promise<unknown>;
}
