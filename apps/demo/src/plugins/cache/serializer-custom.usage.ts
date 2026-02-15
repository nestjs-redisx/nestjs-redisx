import { type ISerializer } from '@nestjs-redisx/cache';

export class CompressedJsonSerializer implements ISerializer {
  serialize<T>(value: T): string {
    return JSON.stringify(value);
  }

  deserialize<T>(data: string | Buffer): T {
    const str = Buffer.isBuffer(data) ? data.toString('utf8') : data;
    return JSON.parse(str) as T;
  }

  tryDeserialize<T>(data: string | Buffer): T | null {
    try {
      return this.deserialize<T>(data);
    } catch {
      return null;
    }
  }

  getContentType(): string {
    return 'application/json+compressed';
  }
}
