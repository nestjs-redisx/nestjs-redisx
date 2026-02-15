import { Body, Controller, Param, Put, UseInterceptors } from '@nestjs/common';
import { CachePut, DeclarativeCacheInterceptor } from '@nestjs-redisx/cache';
import { User, UpdateDto, UserServiceStub } from '../types';

@Controller('users')
@UseInterceptors(DeclarativeCacheInterceptor)
export class UserController {
  constructor(private readonly userService: UserServiceStub) {}

  @CachePut({ key: 'user:{id}', tags: ['users'] })
  @Put(':id')
  async updateUser(@Param('id') id: string, @Body() data: UpdateDto): Promise<User> {
    return this.userService.update(id, data);
  }
}
