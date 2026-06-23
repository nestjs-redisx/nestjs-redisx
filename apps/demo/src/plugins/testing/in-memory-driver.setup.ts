import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { CachePlugin } from '@nestjs-redisx/cache';
import { LocksPlugin } from '@nestjs-redisx/locks';

// Importing the package registers the 'memory' driver with the core registry.
import '@nestjs-redisx/testing';

/**
 * A test module that runs the real plugins against the in-memory driver.
 * Setting `global.driver = 'memory'` swaps the transport — no Redis required.
 * The `clients` block is still required but its host/port are ignored.
 */
@Module({
  imports: [
    RedisModule.forRoot({
      clients: { type: 'single', host: 'localhost', port: 6379 },
      global: { driver: 'memory' },
      plugins: [new CachePlugin(), new LocksPlugin()],
    }),
  ],
})
export class TestAppModule {}
