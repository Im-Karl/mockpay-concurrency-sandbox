import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ConflictException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import Redis from 'ioredis';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const idempotencyKey = request.headers['x-idempotency-key'];
    const bypassRedis = request.query.bypassRedis === 'true';

    // Only enforce idempotency checks on charge/deduction endpoints
    if (!request.url.includes('/deduct')) {
      return next.handle();
    }

    if (!idempotencyKey) {
      throw new BadRequestException({ error: 'Missing X-Idempotency-Key header' });
    }

    // Bypass Redis check to force database unique constraint check (slow-path testing)
    if (bypassRedis) {
      return next.handle();
    }

    const redisKey = `idempotency:${idempotencyKey}`;
    
    // Acquire idempotency lock using SETNX with 60s TTL
    const acquired = await this.redis.set(redisKey, 'PROCESSING', 'EX', 60, 'NX');

    if (!acquired) {
      throw new ConflictException({
        error: 'Transaction is being processed or already succeeded. Please retry in 1 minute.',
      });
    }

    return next.handle();
  }
}
