#!/bin/bash

set -e

echo "Starting Redis Sentinel..."
docker-compose -f docker/docker-compose.sentinel.yml up -d

echo "Waiting for Sentinel to initialize (10 seconds)..."
sleep 10

echo "Checking master status..."
docker exec redis-sentinel-master redis-cli -p 6379 info replication

echo ""
echo "Sentinel 1 info:"
docker exec redis-sentinel-1 redis-cli -p 26379 sentinel master mymaster

echo ""
echo "Redis Sentinel is ready!"
echo "  Master: localhost:6379"
echo "  Replicas: localhost:6380, localhost:6381"
echo "  Sentinels: localhost:26379, localhost:26380, localhost:26381"
