import { Module } from '@nestjs/common';
import { CachePlugin } from '@nestjs-redisx/cache';
import { RateLimitPlugin } from '@nestjs-redisx/rate-limit';
import { RedisTestingModule } from '@nestjs-redisx/testing';

/**
 * `RedisTestingModule` is an ergonomic wrapper around `RedisModule` that forces
 * the in-memory driver for you — no `global.driver` or `clients` boilerplate.
 * Register the same plugins you use in production to test their real behavior.
 */
@Module({
  imports: [
    RedisTestingModule.forRoot({
      plugins: [new CachePlugin(), new RateLimitPlugin({ defaultAlgorithm: 'token-bucket', defaultPoints: 5, defaultDuration: 60 })],
    }),
  ],
})
export class TestAppModule {}
