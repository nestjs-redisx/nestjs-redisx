import { IStreamMessage, MessageHandler, IConsumeOptions, IConsumerHandle, IPendingInfo } from '../../../shared/types';

export interface IStreamConsumer {
  consume<T>(stream: string, group: string, consumer: string, handler: MessageHandler<T>, options?: IConsumeOptions): IConsumerHandle;
  stop(handle: IConsumerHandle): Promise<void>;
  createGroup(stream: string, group: string, startId?: string): Promise<void>;
  getPending(stream: string, group: string): Promise<IPendingInfo>;
  claimIdle<T>(stream: string, group: string, consumer: string, minIdleTime: number): Promise<IStreamMessage<T>[]>;
}
