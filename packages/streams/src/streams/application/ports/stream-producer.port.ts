import { IPublishOptions, IStreamInfo } from '../../../shared/types';

export interface IStreamProducer {
  publish<T>(stream: string, data: T, options?: IPublishOptions): Promise<string>;
  publishBatch<T>(stream: string, messages: T[], options?: IPublishOptions): Promise<string[]>;
  getStreamInfo(stream: string): Promise<IStreamInfo>;
  trim(stream: string, maxLen: number): Promise<number>;
}
