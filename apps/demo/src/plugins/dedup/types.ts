/**
 * Shared stubs for dedup snippet files.
 */

export interface StripeEvent {
  id: string;
  type: string;
  data: unknown;
}

export abstract class Mailer {
  abstract sendOrderConfirmation(orderId: string): Promise<void>;
}

export abstract class SearchIndex {
  abstract rebuild(): Promise<void>;
}
