import { Controller, Delete, Get, Param, UseInterceptors } from '@nestjs/common';
import { Cacheable, CacheEvict, DeclarativeCacheInterceptor } from '@nestjs-redisx/cache';
import { User, UserServiceStub } from './types';

@Controller('users')
@UseInterceptors(DeclarativeCacheInterceptor)
export class UserController {
  constructor(private readonly userService: UserServiceStub) {}

  // Tag on cache
  @Cacheable({ key: 'user:{id}', tags: ['users'] })
  @Get(':id')
  async getUser(@Param('id') id: string): Promise<User> {
    return this.userService.findOne(id);
  }

  // Invalidate by tag (static tags only)
  @CacheEvict({ tags: ['users'] })
  @Delete(':id')
  async deleteUser(@Param('id') id: string): Promise<void> {
    return this.userService.delete(id);
  }
}
