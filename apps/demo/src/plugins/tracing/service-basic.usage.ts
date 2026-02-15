import { Injectable, Inject } from '@nestjs/common';
import { TRACING_SERVICE, ITracingService } from '@nestjs-redisx/tracing';
import { UserRepository } from './types';

@Injectable()
export class UserService {
  constructor(
    @Inject(TRACING_SERVICE) private readonly tracing: ITracingService,
    private readonly userRepo: UserRepository,
  ) {}

  async getUser(id: string): Promise<unknown> {
    return this.tracing.withSpan('user.get', async () => {
      this.tracing.setAttribute('user.id', id);

      const user = await this.userRepo.findById(id);

      this.tracing.addEvent('user.found', {
        'user.email': user.email,
      });

      return user;
    });
  }
}
