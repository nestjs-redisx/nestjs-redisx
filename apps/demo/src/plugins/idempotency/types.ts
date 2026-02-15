// Shared type stubs for idempotency plugin demo snippets

// Domain entities
export interface CreatePaymentDto {
  amount: number;
  currency: string;
  source?: string;
}

export interface Payment {
  id: string;
  status: string;
  amount: number;
  currency: string;
  reference: string;
  transactionRef: string;
}

export interface CreateOrderDto {
  items: Array<{ id: string; quantity: number }>;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: string;
  total: number;
  items: Array<{ id: string; quantity: number }>;
}

export interface PaymentDto {
  amount: number;
  currency?: string;
}

export interface PaymentResponse {
  statusCode: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface BatchItem {
  id: string;
  data: unknown;
}

export interface BatchResult {
  id?: string;
  error?: string;
}

export interface IdempotencyStats {
  total: number;
  byStatus: Record<string, number>;
  recentDuplicates: unknown[];
  topKeys: unknown[];
}

export interface StripeWebhookEvent {
  type: string;
  data: unknown;
}

export interface CreateSubscriptionDto {
  planId: string;
  paymentMethodId: string;
}

export interface RegisterDto {
  email: string;
  password: string;
  name: string;
}

export interface CreateTransferDto {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  currency: string;
}

export interface ProcessBatchDto {
  batchId: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
}

// Abstract service stubs for DI
export abstract class PaymentService {
  abstract process(dto: PaymentDto): Promise<Payment>;
  abstract record(payment: Payment): Promise<void>;
}

export abstract class OrderService {
  abstract create(data: any): Promise<Order>;
}

export abstract class EmailService {
  abstract sendReceipt(payment: Payment): Promise<void>;
  abstract sendOrderConfirmation(order: Order): Promise<void>;
  abstract sendConfirmation(order: Order): Promise<void>;
  abstract sendWelcome(user: any, subscription: any): Promise<void>;
  abstract sendCancellationConfirmation(subscription: any): Promise<void>;
  abstract sendVerification(email: string, token: string): Promise<void>;
  abstract sendBatchReport(batchId: string, summary: any): Promise<void>;
  abstract send(order: Order): Promise<void>;
}

export abstract class InventoryService {
  abstract reserve(items: any[]): Promise<void>;
}

export abstract class WarehouseService {
  abstract notifyNewOrder(order: Order): Promise<void>;
}

export abstract class AnalyticsService {
  abstract trackOrderCreated(order: Order): Promise<void>;
  abstract trackSignup(user: any): Promise<void>;
}

export abstract class PaymentGateway {
  abstract charge(input: any): Promise<Payment>;
}

export abstract class StripeService {
  abstract verifySignature(event: any, signature: string): void;
}

export abstract class SubscriptionService {
  abstract create(data: any): Promise<any>;
  abstract findOne(id: string): Promise<any>;
  abstract markCancelled(id: string): Promise<void>;
}

export abstract class BillingService {
  abstract chargeInitial(subscription: any): Promise<void>;
  abstract cancel(subscription: any): Promise<void>;
}

export abstract class ScheduleService {
  abstract scheduleRecurring(subscription: any): Promise<void>;
}

export abstract class UserService {
  abstract findByEmail(email: string): Promise<any | null>;
  abstract create(data: any): Promise<any>;
}

export abstract class TokenService {
  abstract generateVerification(user: any): Promise<string>;
}

export abstract class SettingsService {
  abstract createDefaults(userId: string): Promise<void>;
}

export abstract class AccountService {
  abstract findOne(id: string): Promise<any>;
  abstract debit(id: string, amount: number, options?: any): Promise<void>;
  abstract credit(id: string, amount: number, options?: any): Promise<void>;
}

export abstract class TransferService {
  abstract create(data: any, options?: any): Promise<any>;
}

export abstract class NotificationService {
  abstract notifyTransferSent(account: any, transfer: any): Promise<void>;
  abstract notifyTransferReceived(account: any, transfer: any): Promise<void>;
}

export abstract class BatchService {
  abstract getItems(batchId: string): Promise<any[]>;
  abstract markCompleted(batchId: string, summary: any): Promise<void>;
}

export abstract class CampaignService {
  abstract findOne(id: string): Promise<any>;
  abstract getRecipients(id: string): Promise<any[]>;
  abstract markSent(id: string): Promise<void>;
}

export abstract class EmailQueue {
  abstract add(job: string, data: any): Promise<void>;
}

export abstract class WebhookService {
  abstract process(event: any): Promise<void>;
}

export abstract class AlertService {
  abstract send(message: string): void;
}

export abstract class DatabaseTx {
  abstract transaction<T>(fn: (tx: any) => Promise<T>): Promise<T>;
}
