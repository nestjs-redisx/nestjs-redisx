/**
 * @fileoverview Redis connection configuration.
 *
 * Supports three modes:
 * - standalone: single Redis server
 * - cluster: Redis Cluster (minimum 3 master nodes)
 * - sentinel: Redis Sentinel (automatic failover)
 *
 * Supports two drivers:
 * - ioredis (default): mature driver, supports natMap for sentinel
 * - node-redis: official Redis driver
 *
 * Env variables:
 * - REDIS_MODE: standalone | cluster | sentinel
 * - REDIS_DRIVER: ioredis | node-redis
 */

import { ConfigService } from '@nestjs/config';
import { IRedisModuleOptions } from '@nestjs-redisx/core';

type DriverType = 'ioredis' | 'node-redis';

export const redisConfig = (config: ConfigService): IRedisModuleOptions => {
  const mode = config.get<string>('REDIS_MODE', 'standalone');
  const driver = config.get<string>('REDIS_DRIVER', 'ioredis') as DriverType;

  // Redis Cluster
  if (mode === 'cluster') {
    return {
      clients: {
        type: 'cluster',
        nodes: [
          {
            host: config.get<string>('REDIS_NODE_1_HOST', 'localhost'),
            port: config.get<number>('REDIS_NODE_1_PORT', 7001),
          },
          {
            host: config.get<string>('REDIS_NODE_2_HOST', 'localhost'),
            port: config.get<number>('REDIS_NODE_2_PORT', 7002),
          },
          {
            host: config.get<string>('REDIS_NODE_3_HOST', 'localhost'),
            port: config.get<number>('REDIS_NODE_3_PORT', 7003),
          },
        ],
        password: config.get<string>('REDIS_PASSWORD'),
        clusterOptions: {
          // NAT mapping for Docker bridge network
          // Maps internal Docker IPs to localhost ports
          natMap: {
            '172.28.0.11:7001': { host: 'localhost', port: 7001 },
            '172.28.0.12:7002': { host: 'localhost', port: 7002 },
            '172.28.0.13:7003': { host: 'localhost', port: 7003 },
            '172.28.0.14:7004': { host: 'localhost', port: 7004 },
            '172.28.0.15:7005': { host: 'localhost', port: 7005 },
            '172.28.0.16:7006': { host: 'localhost', port: 7006 },
          },
        },
      },
      global: {
        driver,
      },
    };
  }

  // Redis Sentinel
  // NOTE: node-redis doesn't support natMap for sentinel
  // Use ioredis driver for sentinel with Docker
  if (mode === 'sentinel') {
    return {
      clients: {
        type: 'sentinel',
        name: config.get<string>('REDIS_SENTINEL_MASTER', 'mymaster'),
        sentinels: [
          {
            host: config.get<string>('REDIS_SENTINEL_1_HOST', 'localhost'),
            port: config.get<number>('REDIS_SENTINEL_1_PORT', 26379),
          },
          {
            host: config.get<string>('REDIS_SENTINEL_2_HOST', 'localhost'),
            port: config.get<number>('REDIS_SENTINEL_2_PORT', 26380),
          },
          {
            host: config.get<string>('REDIS_SENTINEL_3_HOST', 'localhost'),
            port: config.get<number>('REDIS_SENTINEL_3_PORT', 26381),
          },
        ],
        password: config.get<string>('REDIS_PASSWORD'),
        sentinelOptions: {
          // NAT mapping for Docker bridge network (ioredis only)
          // node-redis doesn't support natMap for sentinel
          natMap: {
            '172.23.0.2:6379': { host: 'localhost', port: 6379 },
            '172.23.0.3:6380': { host: 'localhost', port: 6380 },
            '172.23.0.4:6381': { host: 'localhost', port: 6381 },
          },
        },
      },
      global: {
        driver,
      },
    };
  }

  // Standalone (default)
  return {
    clients: {
      type: 'single',
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
      password: config.get<string>('REDIS_PASSWORD'),
      db: config.get<number>('REDIS_DB', 0),
    },
    global: {
      driver,
    },
  };
};
