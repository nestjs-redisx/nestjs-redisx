import { Injectable } from '@nestjs/common';
import { StreamConsumer, IStreamMessage } from '@nestjs-redisx/streams';
import { Order } from './types';

@Injectable()
export class DynamicConsumer {
  private currentConcurrency = 5;

  @StreamConsumer({
    stream: 'orders',
    group: 'processors',
    batchSize: 10,
  })
  async handle(message: IStreamMessage<Order>): Promise<void> {
    // Check system load
    const cpuUsage = await this.getSystemCPUUsage();
    const memUsage = await this.getSystemMemUsage();

    if (cpuUsage > 80 || memUsage > 80) {
      // High load - slow down
      this.currentConcurrency = Math.max(1, this.currentConcurrency - 1);
      await this.sleep(1000);  // Add delay
    } else if (cpuUsage < 50 && memUsage < 50) {
      // Low load - speed up
      this.currentConcurrency = Math.min(20, this.currentConcurrency + 1);
    }

    await this.processOrder(message.data);
    await message.ack();
  }

  private async getSystemCPUUsage(): Promise<number> {
    return 50; // Stub: replace with real CPU monitoring
  }

  private async getSystemMemUsage(): Promise<number> {
    return 50; // Stub: replace with real memory monitoring
  }

  private async processOrder(data: Order): Promise<void> {
    // Process the order
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
