import { createHash } from 'crypto';

import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Inject } from '@nestjs/common';
import { HttpAdapterHost, Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';

import { IDEMPOTENCY_SERVICE, IDEMPOTENCY_PLUGIN_OPTIONS } from '../../../shared/constants';
import { IdempotencyFingerprintMismatchError, IdempotencyFailedError } from '../../../shared/errors';
import { IIdempotencyPluginOptions, IIdempotencyRecord } from '../../../shared/types';
import { IIdempotencyService } from '../../application/ports/idempotency-service.port';
import { IDEMPOTENT_OPTIONS, IIdempotentOptions } from '../decorators/idempotent.decorator';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(IDEMPOTENCY_SERVICE) private readonly idempotencyService: IIdempotencyService,
    @Inject(IDEMPOTENCY_PLUGIN_OPTIONS) private readonly config: IIdempotencyPluginOptions,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const options = this.getOptions(context);
    const response = context.switchToHttp().getResponse();

    const key = await this.extractKey(context, options);

    if (!key) {
      return next.handle();
    }

    if (options.skip && (await options.skip(context))) {
      return next.handle();
    }

    const fingerprint = await this.generateFingerprint(context, options);

    const checkResult = await this.idempotencyService.checkAndLock(key, fingerprint, {
      ttl: options.ttl,
    });

    if (!checkResult.isNew) {
      if (checkResult.fingerprintMismatch) {
        throw new IdempotencyFingerprintMismatchError(key);
      }

      const record = checkResult.record!;

      if (record.status === 'failed') {
        throw new IdempotencyFailedError(key, record.error);
      }

      return this.replayResponse(response, record);
    }

    return next.handle().pipe(
      tap({
        next: (data) => {
          void this.idempotencyService.complete(
            key,
            {
              statusCode: response.statusCode,
              body: data,
              headers: this.extractHeaders(response, options),
            },
            { ttl: options.ttl },
          );
        },
        error: (error) => {
          void this.idempotencyService.fail(key, error.message);
        },
      }),
    );
  }

  private getOptions(context: ExecutionContext): IIdempotentOptions {
    return this.reflector.get<IIdempotentOptions>(IDEMPOTENT_OPTIONS, context.getHandler()) ?? {};
  }

  private async extractKey(context: ExecutionContext, options: IIdempotentOptions): Promise<string | null> {
    if (options.keyExtractor) {
      return options.keyExtractor(context);
    }

    const request = context.switchToHttp().getRequest();
    const headerName = this.config.headerName ?? 'Idempotency-Key';

    return request.headers[headerName.toLowerCase()] ?? null;
  }

  private async generateFingerprint(context: ExecutionContext, options: IIdempotentOptions): Promise<string> {
    if (this.config.fingerprintGenerator) {
      return this.config.fingerprintGenerator(context);
    }

    const request = context.switchToHttp().getRequest();
    const fields = options.fingerprintFields ?? this.config.fingerprintFields ?? ['method', 'path', 'body'];

    const parts: string[] = [];

    if (fields.includes('method')) parts.push(request.method);
    if (fields.includes('path')) parts.push(this.getRequestPath(request));
    if (fields.includes('body')) parts.push(JSON.stringify(request.body ?? {}));
    if (fields.includes('query')) parts.push(JSON.stringify(request.query ?? {}));

    const data = parts.join('|');
    return this.hash(data);
  }

  private getRequestPath(request: unknown): string {
    const httpAdapter = this.adapterHost.httpAdapter;
    const req = request as { path?: string; url?: string };
    return httpAdapter?.getRequestUrl?.(request) ?? req.url ?? req.path ?? '';
  }

  private hash(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  private replayResponse(response: unknown, record: IIdempotencyRecord): Observable<unknown> {
    const httpAdapter = this.adapterHost.httpAdapter;
    if (!httpAdapter) {
      throw new Error('IdempotencyInterceptor: HttpAdapterHost is not initialized. Ensure the NestJS application has bootstrapped with an HTTP adapter before handling requests.');
    }

    httpAdapter.status(response, record.statusCode ?? 200);

    if (record.headers) {
      const headers = JSON.parse(record.headers);
      for (const [key, value] of Object.entries(headers)) {
        httpAdapter.setHeader(response, key, value as string);
      }
    }

    const body = record.response ? JSON.parse(record.response) : null;
    return of(body);
  }

  private extractHeaders(response: { getHeader?: (name: string) => string | number | string[] | undefined }, options: IIdempotentOptions): Record<string, string> | undefined {
    if (!options.cacheHeaders?.length) return undefined;

    const headers: Record<string, string> = {};
    for (const name of options.cacheHeaders) {
      const value = response.getHeader?.(name);
      if (value) headers[name] = String(value);
    }

    return Object.keys(headers).length > 0 ? headers : undefined;
  }
}
