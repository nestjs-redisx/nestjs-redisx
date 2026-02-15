import { IDlqMessage } from '../../../shared/types';

export interface IDeadLetterService {
  add<T>(stream: string, originalId: string, data: T, error?: Error): Promise<string>;
  getMessages<T>(stream: string, count?: number): Promise<IDlqMessage<T>[]>;
  requeue(dlqMessageId: string, stream: string): Promise<string>;
  purge(stream: string): Promise<number>;
}
