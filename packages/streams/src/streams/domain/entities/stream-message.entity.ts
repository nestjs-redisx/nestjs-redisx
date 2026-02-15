import { IStreamMessage } from '../../../shared/types';

export class StreamMessage<T> implements IStreamMessage<T> {
  constructor(
    readonly id: string,
    readonly stream: string,
    readonly data: T,
    readonly attempt: number,
    readonly timestamp: Date,
    private readonly ackFn: () => Promise<void>,
    private readonly rejectFn: (error?: Error) => Promise<void>,
  ) {}

  async ack(): Promise<void> {
    await this.ackFn();
  }

  async reject(error?: Error): Promise<void> {
    await this.rejectFn(error);
  }
}
