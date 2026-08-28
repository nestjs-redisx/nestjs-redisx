/**
 * Shared stubs for leader snippet files.
 */

export abstract class ReportBuilder {
  abstract build(kind: string): Promise<void>;
  abstract cleanup(): Promise<void>;
}

export function alertOps(message: string): void {
  console.warn(message);
}
