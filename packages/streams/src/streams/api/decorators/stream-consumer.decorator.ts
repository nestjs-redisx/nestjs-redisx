import { SetMetadata } from '@nestjs/common';

import { IStreamConsumerOptions } from '../../../shared/types';

export const STREAM_CONSUMER_METADATA = Symbol.for('STREAM_CONSUMER_METADATA');

export function StreamConsumer(options: IStreamConsumerOptions): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    SetMetadata(STREAM_CONSUMER_METADATA, {
      ...options,
      methodName: propertyKey,
    })(target, propertyKey, descriptor);
    return descriptor;
  };
}
