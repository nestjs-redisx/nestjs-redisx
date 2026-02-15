import { Injectable } from '@nestjs/common';
import { Cached, CacheEvict } from '@nestjs-redisx/cache';
import { User, UpdateUserDto, UserRepository } from './types';

@Injectable()
export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  @Cached({
    key: 'user:{0}',
    ttl: 300,
    tags: ['users'],
  })
  async findById(id: string): Promise<User> {
    return this.userRepository.findById(id);
  }

  @CacheEvict({ tags: ['users'] })
  async update(id: string, data: UpdateUserDto): Promise<User> {
    return this.userRepository.update(id, data);
  }
}
