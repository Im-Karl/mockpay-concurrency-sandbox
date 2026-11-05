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
  private static readonly SLIDING_WINDOW_LUA = `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local window = tonumber(ARGV[2])
    local limit = tonumber(ARGV[3])

    redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
    local count = redis.call('ZCARD', key)
    if count >= limit then
      return 0
    end
    redis.call('ZADD', key, now, now .. ':' .. math.random())
    redis.call('EXPIRE', key, window + 1)
    return 1
  `;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const clientKey = request.params.id || request.ip || 'anonymous';
    const key = `rate:${clientKey}`;
    const now = Math.floor(Date.now() / 1000);
    const window = 60;
    const limit = 1000;

    try {
      const allowed = await this.redis.eval(
        RateLimiterGuard.SLIDING_WINDOW_LUA,
        1,
        key,
        now,
        window,
        limit,
      );

      if (allowed === 0) {
        throw new HttpException(
          { error: 'Too many requests. Rate limit exceeded (1000 req/min).' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      return true;
    }
  }
}
