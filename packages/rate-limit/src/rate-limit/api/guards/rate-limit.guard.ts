import { Injectable, CanActivate, ExecutionContext, Inject, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RATE_LIMIT_SERVICE, RATE_LIMIT_PLUGIN_OPTIONS } from '../../../shared/constants';
import { RateLimitExceededError } from '../../../shared/errors';
import { IRateLimitPluginOptions, IRateLimitResult } from '../../../shared/types';
import { IRateLimitService } from '../../application/ports/rate-limit-service.port';
import { RATE_LIMIT_OPTIONS, IRateLimitOptions } from '../decorators/rate-limit.decorator';

// Optional metrics integration
const METRICS_SERVICE = Symbol.for('METRICS_SERVICE');

interface IMetricsService {
  incrementCounter(name: string, labels?: Record<string, string>, value?: number): void;
}

// Optional tracing integration
const TRACING_SERVICE = Symbol.for('TRACING_SERVICE');

interface ISpan {
  setAttribute(key: string, value: unknown): this;
  addEvent(name: string, attributes?: Record<string, unknown>): this;
  setStatus(status: 'OK' | 'ERROR'): this;
  recordException(error: Error): this;
  end(): void;
}

interface ITracingService {
  startSpan(name: string, options?: { kind?: string; attributes?: Record<string, unknown> }): ISpan;
}

/**
 * Rate limit guard.
 * Enforces rate limiting based on @RateLimit() decorator configuration.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(RATE_LIMIT_SERVICE)
    private readonly rateLimitService: IRateLimitService,
    @Inject(RATE_LIMIT_PLUGIN_OPTIONS)
    private readonly config: IRateLimitPluginOptions,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Optional() @Inject(METRICS_SERVICE) private readonly metrics?: IMetricsService,
    @Optional() @Inject(TRACING_SERVICE) private readonly tracing?: ITracingService,
  ) {}

  /**
   * Guard activation logic.
   * Checks rate limit and sets response headers.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.getOptions(context);

    // Check skip condition
    if (await this.shouldSkip(context, options)) {
      return true;
    }

    const key = await this.extractKey(context, options);
    const span = this.tracing?.startSpan('ratelimit.check', {
      kind: 'INTERNAL',
      attributes: { 'ratelimit.key': key },
    });

    try {
      const result = await this.rateLimitService.check(key, options);

      // Set response headers
      this.setHeaders(context, result);

      span?.setAttribute('ratelimit.allowed', result.allowed);
      span?.setAttribute('ratelimit.remaining', result.remaining);
      span?.setAttribute('ratelimit.limit', result.limit);

      if (!result.allowed) {
        this.metrics?.incrementCounter('redisx_ratelimit_requests_total', { status: 'rejected' });
        span?.setStatus('OK'); // Not an error - rate limit working as expected
        throw this.createError(result, options);
      }

      this.metrics?.incrementCounter('redisx_ratelimit_requests_total', { status: 'allowed' });
      span?.setStatus('OK');
      return true;
    } catch (error) {
      if (!(error instanceof RateLimitExceededError)) {
        span?.recordException(error as Error);
        span?.setStatus('ERROR');
      }
      throw error;
    } finally {
      span?.end();
    }
  }

  /**
   * Get rate limit options from decorator metadata.
   * Merges class-level and method-level options.
   */
  private getOptions(context: ExecutionContext): IRateLimitOptions {
    const handlerOptions = this.reflector.get<IRateLimitOptions>(RATE_LIMIT_OPTIONS, context.getHandler());
    const classOptions = this.reflector.get<IRateLimitOptions>(RATE_LIMIT_OPTIONS, context.getClass());

    return { ...classOptions, ...handlerOptions };
  }

  /**
   * Extract rate limit key from context.
   */
  private async extractKey(context: ExecutionContext, options: IRateLimitOptions): Promise<string> {
    const extractor = options.key ?? this.config.defaultKeyExtractor ?? 'ip';

    // Custom function
    if (typeof extractor === 'function') {
      return await extractor(context);
    }

    // String key
    if (typeof extractor === 'string' && !['ip', 'user', 'apiKey'].includes(extractor)) {
      return extractor;
    }

    // Predefined extractors
    const request = context.switchToHttp().getRequest();

    switch (extractor) {
      case 'ip':
        return this.getClientIp(request);
      case 'user':
        return this.getUserId(request);
      case 'apiKey':
        return this.getApiKey(request);
      default:
        return this.getClientIp(request);
    }
  }

  /**
   * Get client IP address.
   */
  private getClientIp(request: Request & { ip?: string; ips?: string[] }): string {
    // Check X-Forwarded-For header
    const forwardedFor = (request.headers as unknown as Record<string, string>)['x-forwarded-for'];
    if (forwardedFor) {
      const ips = forwardedFor.split(',').map((ip) => ip.trim());
      return ips[0] || 'unknown';
    }

    // Check X-Real-IP header
    const realIp = (request.headers as unknown as Record<string, string>)['x-real-ip'];
    if (realIp) {
      return realIp;
    }

    // Fall back to request.ip
    return request.ip || 'unknown';
  }

  /**
   * Get user ID from request.
   */
  private getUserId(request: Request & { user?: { id?: string } }): string {
    const userId = request.user?.id;
    if (!userId) {
      throw new Error('User ID not found. Ensure authentication guard runs before rate limit guard.');
    }
    return `user:${userId}`;
  }

  /**
   * Get API key from request.
   */
  private getApiKey(request: Request): string {
    const apiKey = (request.headers as unknown as Record<string, string>)['x-api-key'] || (request.headers as unknown as Record<string, string>)['authorization'];

    if (!apiKey) {
      throw new Error('API key not found. Ensure request includes X-API-Key or Authorization header.');
    }

    return `apikey:${apiKey}`;
  }

  /**
   * Set response headers.
   */
  private setHeaders(context: ExecutionContext, result: IRateLimitResult): void {
    if (this.config.includeHeaders === false) {
      return;
    }

    const response = context.switchToHttp().getResponse();
    const headers = this.config.headers ?? {};

    const limitHeader = headers.limit ?? 'X-RateLimit-Limit';
    const remainingHeader = headers.remaining ?? 'X-RateLimit-Remaining';
    const resetHeader = headers.reset ?? 'X-RateLimit-Reset';
    const retryAfterHeader = headers.retryAfter ?? 'Retry-After';

    response.header(limitHeader, result.limit.toString());
    response.header(remainingHeader, result.remaining.toString());
    response.header(resetHeader, result.reset.toString());

    if (!result.allowed && result.retryAfter) {
      response.header(retryAfterHeader, result.retryAfter.toString());
    }
  }

  /**
   * Create error when rate limit exceeded.
   */
  private createError(result: IRateLimitResult, options: IRateLimitOptions): Error {
    // Use custom error factory if provided
    if (options.errorFactory) {
      return options.errorFactory(result);
    }

    // Use module-level error factory if provided
    if (this.config.errorFactory) {
      return this.config.errorFactory(result);
    }

    // Default error
    const message = options.message ?? `Rate limit exceeded. Try again in ${result.retryAfter || 0} seconds.`;

    return new RateLimitExceededError(message, result);
  }

  /**
   * Check if rate limiting should be skipped.
   */
  private async shouldSkip(context: ExecutionContext, options: IRateLimitOptions): Promise<boolean> {
    // Check decorator-level skip
    if (options.skip) {
      return await options.skip(context);
    }

    // Check module-level skip
    if (this.config.skip) {
      return await this.config.skip(context);
    }

    return false;
  }
}
