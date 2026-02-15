#!/bin/bash

set -e

echo "Starting Redis Cluster..."
docker-compose -f docker/docker-compose.cluster.yml up -d

echo "Waiting for cluster to initialize (15 seconds)..."
sleep 15

echo "Checking cluster status..."
docker exec redis-cluster-1 redis-cli -p 7001 cluster info

echo ""
echo "Cluster nodes:"
docker exec redis-cluster-1 redis-cli -p 7001 cluster nodes

echo ""
echo "Redis Cluster is ready!"
echo "  Masters: localhost:7001, localhost:7002, localhost:7003"
echo "  Replicas: localhost:7004, localhost:7005, localhost:7006"
