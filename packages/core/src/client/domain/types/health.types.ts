import { ConnectionStatus } from '../../../types';

/**
 * Health check status for Redis client.
 */
export interface IHealthStatus {
  /**
   * Client name.
   */
  name: string;

  /**
   * Whether client is healthy (connected and responsive).
   */
  healthy: boolean;

  /**
   * Current connection status.
   */
  status: ConnectionStatus;

  /**
   * Latency in milliseconds (from PING command).
   * null if not connected or ping failed.
   */
  latency: number | null;

  /**
   * Last error if any.
   */
  lastError: string | null;

  /**
   * Timestamp of last successful check.
   */
  lastCheckAt: Date;

  /**
   * Additional metadata.
   */
  metadata: {
    /**
     * Driver type (ioredis or node-redis).
     */
    driverType: string;

    /**
     * Connection type (single, cluster, sentinel).
     */
    connectionType: string;

    /**
     * Number of reconnection attempts.
     */
    reconnectAttempts: number;

    /**
     * Uptime in milliseconds.
     */
    uptime: number;
  };
}

/**
 * Connection statistics for all clients.
 */
export interface IConnectionStats {
  /**
   * Total number of registered clients.
   */
  totalClients: number;

  /**
   * Number of connected clients.
   */
  connectedClients: number;

  /**
   * Number of disconnected clients.
   */
  disconnectedClients: number;

  /**
   * Number of clients with errors.
   */
  errorClients: number;

  /**
   * Per-client statistics.
   */
  clients: Record<string, IClientStats>;

  /**
   * Timestamp when stats were collected.
   */
  collectedAt: Date;
}

/**
 * Statistics for individual client.
 */
export interface IClientStats {
  /**
   * Client name.
   */
  name: string;

  /**
   * Current status.
   */
  status: ConnectionStatus;

  /**
   * Total commands executed.
   */
  commandsExecuted: number;

  /**
   * Total errors.
   */
  errors: number;

  /**
   * Total reconnections.
   */
  reconnections: number;

  /**
   * Average latency in milliseconds.
   */
  averageLatency: number;

  /**
   * Peak latency in milliseconds.
   */
  peakLatency: number;

  /**
   * Last activity timestamp.
   */
  lastActivityAt: Date | null;

  /**
   * Connected since timestamp.
   */
  connectedAt: Date | null;

  /**
   * Total uptime in milliseconds.
   */
  uptime: number;
}

/**
 * Reconnection options.
 */
export interface IReconnectionOptions {
  /**
   * Maximum number of reconnection attempts.
   * @default Infinity
   */
  maxAttempts?: number;

  /**
   * Initial delay in milliseconds.
   * @default 1000
   */
  initialDelay?: number;

  /**
   * Maximum delay in milliseconds.
   * @default 30000
   */
  maxDelay?: number;

  /**
   * Exponential backoff multiplier.
   * @default 2
   */
  backoffMultiplier?: number;

  /**
   * Enable jitter to prevent thundering herd.
   * @default true
   */
  enableJitter?: boolean;
}
