import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

const requestCounts = new Map<string, { count: number; resetTime: number }>();

interface RateLimitedRequest {
  ip?: string;
  connection?: {
    remoteAddress?: string;
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isRateLimitDisabled(): boolean {
  const flag = process.env.RATE_LIMIT_DISABLED?.trim().toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

@Injectable()
export class ThrottleGuard implements CanActivate {
  private readonly limit = parsePositiveInt(
    process.env.RATE_LIMIT_MAX,
    process.env.NODE_ENV === 'production' ? 100 : 1000,
  );
  private readonly windowMs = parsePositiveInt(
    process.env.RATE_LIMIT_WINDOW_MS,
    60_000,
  );

  canActivate(context: ExecutionContext): boolean {
    if (isRateLimitDisabled()) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RateLimitedRequest>();
    const ip = request.ip ?? request.connection?.remoteAddress ?? 'unknown';
    const now = Date.now();
    const entry = requestCounts.get(ip);

    if (!entry || now > entry.resetTime) {
      requestCounts.set(ip, { count: 1, resetTime: now + this.windowMs });
      return true;
    }

    if (entry.count >= this.limit) {
      throw new HttpException(
        'Too many requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    entry.count++;
    return true;
  }
}
