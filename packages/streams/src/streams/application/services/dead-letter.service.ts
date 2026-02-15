import { Injectable, Inject } from '@nestjs/common';
import { REDIS_DRIVER, IRedisDriver } from '@nestjs-redisx/core';

import { STREAMS_PLUGIN_OPTIONS } from '../../../shared/constants';
import { IStreamsPluginOptions, IDlqMessage } from '../../../shared/types';
import { IDeadLetterService } from '../ports/dead-letter.port';

/** Default number of DLQ messages to fetch in a single call. */
const DEFAULT_DLQ_FETCH_COUNT = 100;

@Injectable()
export class DeadLetterService implements IDeadLetterService {
  constructor(
    @Inject(REDIS_DRIVER) private readonly driver: IRedisDriver,
    @Inject(STREAMS_PLUGIN_OPTIONS)
    private readonly config: IStreamsPluginOptions,
  ) {}

  async add<T>(stream: string, originalId: string, data: T, error?: Error): Promise<string> {
    if (!this.config.dlq?.enabled) {
      return '';
    }

    const dlqStream = `${stream}${this.config.dlq.streamSuffix ?? ':dlq'}`;
    const maxLen = this.config.dlq.maxLen ?? 10000;

    return await this.driver.xadd(
      dlqStream,
      '*',
      {
        data: JSON.stringify(data),
        originalId,
        originalStream: stream,
        error: error?.message ?? 'Unknown error',
        failedAt: Date.now().toString(),
      },
      { maxLen, approximate: true },
    );
  }

  async getMessages<T>(stream: string, count = DEFAULT_DLQ_FETCH_COUNT): Promise<IDlqMessage<T>[]> {
    const dlqSuffix = this.config.dlq?.streamSuffix ?? ':dlq';
    const dlqStream = `${stream}${dlqSuffix}`;
    const entries = await this.driver.xrange(dlqStream, '-', '+', { count });

    return entries.map((entry) => ({
      id: entry.id,
      data: JSON.parse(entry.fields.data!) as T,
      originalId: entry.fields.originalId!,
      originalStream: entry.fields.originalStream!,
      error: entry.fields.error!,
      failedAt: new Date(parseInt(entry.fields.failedAt!, 10)),
    }));
  }

  async requeue(dlqMessageId: string, stream: string): Promise<string> {
    const dlqSuffix = this.config.dlq?.streamSuffix ?? ':dlq';
    const dlqStream = `${stream}${dlqSuffix}`;
    const entries = await this.driver.xrange(dlqStream, dlqMessageId, dlqMessageId);

    if (!entries.length) {
      throw new Error(`DLQ message ${dlqMessageId} not found`);
    }

    const entry = entries[0]!;
    const newId = await this.driver.xadd(stream, '*', {
      data: entry.fields.data!,
      _attempt: '1',
    });
    await this.driver.xdel(dlqStream, dlqMessageId);

    return newId;
  }

  async purge(stream: string): Promise<number> {
    const dlqSuffix = this.config.dlq?.streamSuffix ?? ':dlq';
    const dlqStream = `${stream}${dlqSuffix}`;
    return await this.driver.del(dlqStream);
  }
}
