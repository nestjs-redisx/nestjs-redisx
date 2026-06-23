import { NestFactory } from '@nestjs/core';
import { StreamsPlugin, STREAM_PRODUCER, STREAM_CONSUMER, type IStreamProducer, type IStreamConsumer } from '@nestjs-redisx/streams';
import { RedisTestingModule } from '@nestjs-redisx/testing';

/**
 * Round-trips a Streams message through the real producer and a consumer group
 * on the in-memory driver — no Redis. The consumer reads via XREADGROUP, the
 * handler runs, and the message is auto-acked. Returns the payloads received.
 */
export async function streamRoundTrip(): Promise<Array<{ n: number }>> {
  const app = await NestFactory.createApplicationContext(RedisTestingModule.forRoot({ plugins: [new StreamsPlugin()] }), { logger: false });

  const producer = app.get<IStreamProducer>(STREAM_PRODUCER);
  const consumer = app.get<IStreamConsumer>(STREAM_CONSUMER);

  const received: Array<{ n: number }> = [];
  const handle = consumer.consume<{ n: number }>('orders', 'workers', 'c1', async (msg) => {
    received.push(msg.data);
  });

  await producer.publish('orders', { n: 1 });
  await new Promise((resolve) => setTimeout(resolve, 50)); // let the consumer poll

  await consumer.stop(handle);
  await app.close();
  return received; // [{ n: 1 }]
}
