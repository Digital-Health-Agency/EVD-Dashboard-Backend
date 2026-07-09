import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request, Response } from 'express';
import { getRequestAppId } from '../app-id.js';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  private readonly sensitiveFields = [
    'password',
    'token',
    'authorization',
    'secret',
    'apiKey',
    'apikey',
    'accessToken',
    'refreshToken',
  ];

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const { method, url, ip } = request;
    const userAgent = request.get('user-agent') || '';
    const appId = getRequestAppId(request);
    const startTime = Date.now();

    this.logger.log(
      `${method} ${url} - App: ${appId} - IP: ${ip} - User-Agent: ${userAgent}`,
    );

    const requestBody = request.body as unknown;
    if (this.hasEntries(requestBody)) {
      const sanitizedBody = this.sanitizeData(requestBody);
      this.logger.debug(
        `Request Body: ${JSON.stringify(sanitizedBody, null, 2)}`,
      );
    }

    if (request.query && Object.keys(request.query).length > 0) {
      const sanitizedQuery = this.sanitizeData(request.query);
      this.logger.debug(
        `Query Params: ${JSON.stringify(sanitizedQuery, null, 2)}`,
      );
    }

    return next.handle().pipe(
      tap({
        next: (data) => {
          const responseTime = Date.now() - startTime;
          const statusCode = response.statusCode;

          this.logger.log(
            `${method} ${url} - App: ${appId} - Status: ${statusCode} - Time: ${responseTime}ms`,
          );

          if (data !== null && data !== undefined) {
            const sanitizedResponse = this.sanitizeData(data);
            this.logger.debug(
              `Response Body: ${JSON.stringify(sanitizedResponse, null, 2)}`,
            );
          }
        },
        error: (error: unknown) => {
          const responseTime = Date.now() - startTime;
          const err = error as {
            status?: number;
            message?: string;
            response?: unknown;
            getResponse?: () => unknown;
          };
          const statusCode = err?.status || response.statusCode || 500;

          this.logger.error(
            `${method} ${url} - App: ${appId} - Status: ${statusCode} - Time: ${responseTime}ms - Error: ${err?.message || 'Unknown error'}`,
          );

          const errorResponse =
            err?.response ||
            (typeof err?.getResponse === 'function' ? err.getResponse() : null);
          if (errorResponse !== null && errorResponse !== undefined) {
            const sanitizedErrorResponse = this.sanitizeData(errorResponse);
            this.logger.debug(
              `Error Response Body: ${JSON.stringify(sanitizedErrorResponse, null, 2)}`,
            );
          }
        },
      }),
    );
  }

  private sanitizeData(
    data: unknown,
    visited: WeakSet<object> = new WeakSet(),
  ): unknown {
    if (data === null || data === undefined) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitizeData(item, visited));
    }

    if (typeof data === 'object') {
      if (visited.has(data)) {
        return '[Circular]';
      }

      visited.add(data);

      let objectToProcess: unknown = data;
      if (typeof (data as { toJSON?: () => unknown }).toJSON === 'function') {
        objectToProcess = (data as { toJSON: () => unknown }).toJSON();
        if (typeof objectToProcess === 'object' && objectToProcess !== null) {
          if (visited.has(objectToProcess)) {
            return '[Circular]';
          }
          visited.add(objectToProcess);
        }
      }

      if (typeof objectToProcess !== 'object' || objectToProcess === null) {
        return objectToProcess;
      }

      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(objectToProcess)) {
        const lowerKey = key.toLowerCase();
        if (this.sensitiveFields.some((field) => lowerKey.includes(field))) {
          sanitized[key] = '***MASKED***';
        } else if (typeof value === 'object' && value !== null) {
          sanitized[key] = this.sanitizeData(value, visited);
        } else {
          sanitized[key] = value;
        }
      }
      return sanitized;
    }

    return data;
  }

  private hasEntries(data: unknown): data is Record<string, unknown> {
    return (
      typeof data === 'object' && data !== null && Object.keys(data).length > 0
    );
  }
}
