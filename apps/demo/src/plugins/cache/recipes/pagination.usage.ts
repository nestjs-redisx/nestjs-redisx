import { Injectable } from '@nestjs/common';
import { Cached, InvalidateTags } from '@nestjs-redisx/cache';
import { Post, PaginatedResult, CreatePostDto, PostRepository } from '../types';

@Injectable()
export class PostService {
  constructor(private readonly repository: PostRepository) {}

  @Cached({
    key: 'posts:page:{0}:size:{1}',
    ttl: 300,
    tags: ['posts:list'],
  })
  async findPaginated(page: number, size: number): Promise<PaginatedResult<Post>> {
    // page is 1-based: page=1 returns first `size` items
    return this.repository.findMany({
      skip: (page - 1) * size,
      take: size,
    });
  }

  @InvalidateTags({ tags: ['posts:list'] })
  async create(data: CreatePostDto): Promise<Post> {
    return this.repository.create(data);
  }
}
