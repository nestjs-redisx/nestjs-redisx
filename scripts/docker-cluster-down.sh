#!/bin/bash

set -e

echo "Stopping Redis Cluster..."
docker-compose -f docker/docker-compose.cluster.yml down -v

echo "Redis Cluster stopped and volumes removed"
