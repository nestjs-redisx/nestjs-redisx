// Shared type stubs for streams plugin demo snippets

// Domain types
export interface Order {
  id: string;
  customerId: string;
  items: unknown[];
  total: number;
  createdAt: Date;
  processed?: boolean;
}

export interface CreateOrderDto {
  items: unknown[];
  total: number;
  customerId?: string;
}

export interface OrderEvent {
  type: string;
  orderId: string;
  customerId?: string;
  total?: number;
  items?: unknown[];
  paymentId?: string;
  error?: string;
  data?: any;
}

export interface OrderStats {
  totalEvents: number;
  oldestEvent?: Date;
  newestEvent?: Date;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  channels: string[];
}

export interface NotificationEvent {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  channels: string[];
}

export interface Task {
  id: string;
  type: string;
  data: any;
  priority?: string;
  createdAt?: Date;
}

export interface SagaEvent {
  type: string;
  orderId?: string;
  sagaId: string;
  step: string;
  data: any;
}

export interface AuditEvent {
  action: string;
  userId: string;
  resource: string;
  resourceId: string;
  changes: unknown;
  timestamp?: Date;
  ipAddress?: string;
  userAgent?: string;
}

export interface WebhookEvent {
  id: string;
  url: string;
  event: string;
  payload: unknown;
  signature: string;
}

export interface Webhook {
  id: string;
  url: string;
  event: string;
  payload: unknown;
}

export interface ImageUpload {
  id: string;
  userId: string;
  url: string;
}

export interface ImageJob {
  id: string;
  userId: string;
  url: string;
  operations: Array<{ type: string; width?: number; height?: number; text?: string }>;
}

export interface Campaign {
  id: string;
  template: string;
}

export interface CampaignEmail {
  campaignId: string;
  recipientId: string;
  email: string;
  template: string;
  variables: Record<string, string>;
}

export interface ExportRequest {
  userId: string;
  type: string;
  filters: Record<string, unknown>;
  format: string;
}

export interface ExportJob {
  jobId: string;
  userId: string;
  type: string;
  filters: Record<string, unknown>;
  format: string;
}

export interface AnalyticsEvent {
  type: string;
  eventType?: string;
  userId: string;
  properties: Record<string, unknown>;
  timestamp?: Date;
}

export interface Job {
  id: string;
  type: string;
  data: any;
  priority?: string;
  createdAt?: Date;
}

// Abstract service stubs for DI
export abstract class OrderRepository {
  abstract create(dto: any, options?: any): Promise<Order>;
  abstract findOne(id: string): Promise<Order | null>;
  abstract update(id: string, data: Partial<Order>): Promise<void>;
  abstract cancel(id: string): Promise<void>;
}

export abstract class FulfillmentService {
  abstract fulfill(data: any): Promise<void>;
  abstract process(orderId: string): Promise<void>;
}

export abstract class PaymentService {
  abstract charge(data: any): Promise<{ id: string }>;
  abstract refund(data: any): Promise<void>;
}

export abstract class InventoryService {
  abstract reserve(orderId: string): Promise<void>;
}

export abstract class ShippingService {
  abstract createShipment(orderId: string): Promise<void>;
}

export abstract class OrderService {
  abstract process(data: any): Promise<void>;
  abstract fulfill(data: any): Promise<void>;
}

export abstract class AnalyticsService {
  abstract track(data: any): Promise<void>;
}

export abstract class EmailService {
  abstract send(data: any): Promise<void>;
  abstract sendConfirmation(data: any): Promise<void>;
}

export abstract class SmsService {
  abstract send(data: any): Promise<void>;
}

export abstract class PushService {
  abstract send(data: any): Promise<void>;
}

export abstract class AlertService {
  abstract send(data: any): Promise<void>;
}

export abstract class AuditRepo {
  abstract create(data: any): Promise<void>;
  abstract find(query: any): Promise<AuditEvent[]>;
}

export abstract class WebhookRepo {
  abstract updateStatus(id: string, status: string): Promise<void>;
  abstract logAttempt(id: string, data: any): Promise<void>;
}

export abstract class ImageRepo {
  abstract update(id: string, data: any): Promise<void>;
}

export abstract class CampaignRepo {
  abstract incrementSent(campaignId: string): Promise<void>;
  abstract incrementBounced(campaignId: string): Promise<void>;
}

export abstract class ExportRepo {
  abstract updateStatus(jobId: string, status: string): Promise<void>;
}

export abstract class OutboxRepo {
  abstract create(data: any, options?: any): Promise<void>;
  abstract findUnpublished(): Promise<Array<{ id: string; eventType: string; payload: any }>>;
  abstract markPublished(id: string): Promise<void>;
}

export abstract class DatabaseTransaction {
  abstract transaction<T>(fn: (tx: any) => Promise<T>): Promise<T>;
}

export abstract class S3Service {
  abstract upload(file: any): Promise<string>;
}

export abstract class ReportService {
  abstract generate(data: any): Promise<void>;
}

export abstract class ImageService {
  abstract process(data: any): Promise<void>;
}

export abstract class JobQueue {
  abstract add(job: Job): Promise<void>;
}

export abstract class WarehouseService {
  abstract insert(table: string, data: any): Promise<void>;
}

export abstract class TimeseriesDb {
  abstract insert(data: any): Promise<void>;
}

export abstract class OrderViewRepo {
  abstract create(data: any): Promise<void>;
  abstract update(id: string, data: any): Promise<void>;
  abstract upsert(data: any): Promise<void>;
  abstract findOne(id: string): Promise<any>;
  abstract find(filter: any): Promise<any[]>;
}
