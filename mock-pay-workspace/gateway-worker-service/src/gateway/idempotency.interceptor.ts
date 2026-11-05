import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ConflictException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { Observable, catchError, throwError } from 'rxjs';
import Redis from 'ioredis';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const idempotencyKey = request.headers['x-idempotency-key'];

    if (!request.url.includes('/deduct')) {
      return next.handle();
    }

    if (!idempotencyKey) {
      throw new BadRequestException({ error: 'Missing X-Idempotency-Key header' });
    }

    const bypassRedis = request.query.bypassRedis === 'true';
    if (bypassRedis) {
      return next.handle();
    }

    const redisKey = `idempotency:${idempotencyKey}`;
    const acquired = this.redis.set(redisKey, 'PROCESSING', 'EX', 60, 'NX');

    if (!acquired) {
      throw new ConflictException({
        error: 'Transaction is being processed or already succeeded. Please retry in 1 minute.',
      });
    }

    return next.handle().pipe(
      catchError((err) => {
        this.redis.del(redisKey).catch(() => {});
        return throwError(() => err);
      })
    );
  }
}
