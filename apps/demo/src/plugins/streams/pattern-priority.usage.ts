import { Injectable } from '@nestjs/common';
import { StreamConsumer, IStreamMessage } from '@nestjs-redisx/streams';
import { Task } from './types';

@Injectable()
export class PriorityProcessor {
  // High priority - more resources
  @StreamConsumer({
    stream: 'tasks:high',
    group: 'processors',
    concurrency: 10,
    batchSize: 50,
  })
  async processHigh(message: IStreamMessage<Task>): Promise<void> {
    await this.processTask(message.data);
    await message.ack();
  }

  // Low priority - fewer resources
  @StreamConsumer({
    stream: 'tasks:low',
    group: 'processors',
    concurrency: 2,
    batchSize: 10,
  })
  async processLow(message: IStreamMessage<Task>): Promise<void> {
    await this.processTask(message.data);
    await message.ack();
  }

  private async processTask(data: Task): Promise<void> {
    // Process the task based on type
  }
}
