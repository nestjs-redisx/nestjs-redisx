import { Injectable, Inject, Logger } from '@nestjs/common';
import { LOCK_SERVICE, ILockService, ILock, ILockOptions } from '@nestjs-redisx/locks';

@Injectable()
export class LoggingLockService {
  private readonly logger = new Logger('Locks');

  constructor(
    @Inject(LOCK_SERVICE) private readonly lockService: ILockService,
  ) {}

  async acquire(key: string, options?: ILockOptions): Promise<ILock> {
    this.logger.debug(`Acquiring lock: ${key}`);
    const lock = await this.lockService.acquire(key, options);
    this.logger.debug(`Lock acquired: ${key}`);
    return lock;
  }
}
