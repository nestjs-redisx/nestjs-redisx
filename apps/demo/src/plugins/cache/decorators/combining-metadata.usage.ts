import { Body, Controller, Delete, Get, Param, Put, UseInterceptors } from '@nestjs/common';
import {
  Cacheable,
  CachePut,
  CacheEvict,
  DeclarativeCacheInterceptor,
} from '@nestjs-redisx/cache';
import { User, UpdateDto, UserServiceStub } from '../types';

@Controller('users')
@UseInterceptors(DeclarativeCacheInterceptor)
export class UserController {
  constructor(private readonly userService: UserServiceStub) {}

  // Read: use cache
  @Cacheable({ key: 'user:{id}', tags: ['users', 'user:{id}'] })
  @Get(':id')
  async getUser(@Param('id') id: string): Promise<User> {
    return this.userService.findOne(id);
  }

  // Update: update cache + invalidate list
  @CachePut({ key: 'user:{id}', tags: ['users'] })
  @CacheEvict({ keys: ['users:list', 'users:count'] })
  @Put(':id')
  async updateUser(@Param('id') id: string, @Body() data: UpdateDto): Promise<User> {
    return this.userService.update(id, data);
  }

  // Delete: invalidate everything related
  @CacheEvict({ tags: ['users'], keys: ['users:list', 'users:count'] })
  @Delete(':id')
  async deleteUser(@Param('id') id: string): Promise<void> {
    return this.userService.delete(id);
  }
}
