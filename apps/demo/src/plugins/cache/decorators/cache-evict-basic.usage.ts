import { Controller, Delete, Param, UseInterceptors } from '@nestjs/common';
import { CacheEvict, DeclarativeCacheInterceptor } from '@nestjs-redisx/cache';
import { UserServiceStub } from '../types';

@Controller('users')
@UseInterceptors(DeclarativeCacheInterceptor)
export class UserController {
  constructor(private readonly userService: UserServiceStub) {}

  @CacheEvict({ keys: ['user:{id}'], tags: ['users'] })
  @Delete(':id')
  async deleteUser(@Param('id') id: string): Promise<void> {
    return this.userService.delete(id);
  }
}
