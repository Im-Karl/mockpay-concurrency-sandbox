import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Inject,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RateLimiterGuard implements CanActivate {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const clientKey = request.params.id || request.ip || 'anonymous';
    const key = `rate:${clientKey}`;
    const currentSecond = Math.floor(Date.now() / 1000);
    const windowStart = currentSecond - 60;

    try {
      // 1. Clean up expired sliding window buckets (older than 60s)
      const fields = await this.redis.hkeys(key);
      for (const field of fields) {
        if (parseInt(field, 10) < windowStart) {
          await this.redis.hdel(key, field);
        }
      }

      // 2. Calculate total requests in the active sliding window
      const allRequests = await this.redis.hvals(key);
      const total = allRequests.reduce((sum, val) => sum + parseInt(val, 10), 0);

      if (total >= 1000) {
        throw new HttpException(
          { error: 'Too many requests. Rate limit exceeded (1000 req/min). Please try again later.' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // 3. Record new request in the current second's bucket
      await this.redis.hincrby(key, currentSecond.toString(), 1);
      await this.redis.expire(key, 120); // Keep memory footprint clean with 120s TTL
      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      console.error('Rate limiter exception:', error.message);
      return true; // Graceful degradation: allow requests if Redis is unavailable
    }
  }
}
