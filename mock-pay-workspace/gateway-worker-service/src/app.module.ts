import { Module } from '@nestjs/common';
import { RedisModule } from './redis/redis.module';
import { GatewayController } from './gateway/gateway.controller';
import { WebhookWorkerService } from './gateway/webhook-worker.service';
import { RateLimiterGuard } from './gateway/rate-limiter.guard';

@Module({
  imports: [RedisModule],
  controllers: [GatewayController],
  providers: [WebhookWorkerService, RateLimiterGuard],
})
export class AppModule {}
