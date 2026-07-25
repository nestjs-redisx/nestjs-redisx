// Shared type stubs for pubsub plugin demo snippets

export interface UserCreatedEvent {
  id: string;
  email: string;
}

export interface OrderEvent {
  orderId: string;
  status: string;
}

// Abstract dependencies (stubs for DI in snippets)
export abstract class NotificationGateway {
  abstract broadcast(event: string, payload: unknown): void;
}
