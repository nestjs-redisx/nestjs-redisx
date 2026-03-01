export interface IStreamsPluginOptions {
  /**
   * Make the module global.
   * @default false
   */
  isGlobal?: boolean;

  /** Named Redis client to use. @default 'default' */
  client?: string;

  keyPrefix?: string; // default: 'stream:'

  consumer?: {
    blockTimeout?: number; // default: 5000ms
    batchSize?: number; // default: 10
    maxRetries?: number; // default: 3
    claimIdleTimeout?: number; // default: 30000ms
    concurrency?: number; // default: 1
  };
  dlq?: {
    enabled?: boolean; // default: true
    streamSuffix?: string; // default: ':dlq'
    maxLen?: number; // default: 10000
  };
  producer?: {
    maxLen?: number; // default: 100000
    autoCreate?: boolean; // default: true
  };
  retry?: {
    maxRetries?: number; // default: 3
    initialDelay?: number; // default: 1000ms
    maxDelay?: number; // default: 30000ms
    multiplier?: number; // default: 2
  };
  trim?: {
    enabled?: boolean; // default: true
    maxLen?: number; // default: 100000
    strategy?: 'MAXLEN' | 'MINID';
    approximate?: boolean; // default: true
  };
}

export interface IStreamMessage<T = unknown> {
  readonly id: string;
  readonly stream: string;
  readonly data: T;
  readonly attempt: number;
  readonly timestamp: Date;
  ack(): Promise<void>;
  reject(error?: Error): Promise<void>;
}

export type MessageHandler<T> = (message: IStreamMessage<T>) => Promise<void>;

export interface IPublishOptions {
  maxLen?: number;
  id?: string;
}

export interface IStreamInfo {
  length: number;
  firstEntry?: { id: string; timestamp: Date };
  lastEntry?: { id: string; timestamp: Date };
  groups: number;
}

export interface IConsumeOptions {
  batchSize?: number;
  blockTimeout?: number;
  maxRetries?: number;
  concurrency?: number;
  startId?: '>' | '0' | string;
}

export interface IConsumerHandle {
  id: string;
  isRunning: boolean;
}

export interface IPendingInfo {
  count: number;
  minId: string;
  maxId: string;
  consumers: Array<{ name: string; pending: number }>;
}

export interface IDlqMessage<T> {
  id: string;
  data: T;
  originalId: string;
  originalStream: string;
  error: string;
  failedAt: Date;
}

export interface IStreamConsumerOptions {
  stream: string;
  group: string;
  consumer?: string;
  batchSize?: number;
  blockTimeout?: number;
  maxRetries?: number;
  concurrency?: number;
}

// Type aliases for backward compatibility (non-I-prefixed)
export type PublishOptions = IPublishOptions;
export type StreamInfo = IStreamInfo;
export type ConsumeOptions = IConsumeOptions;
export type ConsumerHandle = IConsumerHandle;
export type PendingInfo = IPendingInfo;
export type DlqMessage<T = unknown> = IDlqMessage<T>;
export type StreamConsumerOptions = IStreamConsumerOptions;
