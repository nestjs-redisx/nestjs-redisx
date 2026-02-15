import { Controller, Get, Param, UseInterceptors } from '@nestjs/common';
import { Cacheable, DeclarativeCacheInterceptor } from '@nestjs-redisx/cache';
import { User, UserServiceStub } from '../types';

@Controller('users')
@UseInterceptors(DeclarativeCacheInterceptor)
export class UserController {
  constructor(private readonly userService: UserServiceStub) {}

  @Cacheable({ key: 'user:{id}', ttl: 300 })
  @Get(':id')
  async getUser(@Param('id') id: string): Promise<User> {
    return this.userService.findOne(id);
  }
}
