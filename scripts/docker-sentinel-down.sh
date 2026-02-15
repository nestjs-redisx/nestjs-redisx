#!/bin/bash

set -e

echo "Stopping Redis Sentinel..."
docker-compose -f docker/docker-compose.sentinel.yml down -v

echo "Redis Sentinel stopped and volumes removed"
