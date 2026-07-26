import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  UseInterceptors,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import axios from 'axios';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { RateLimiterGuard } from './rate-limiter.guard';

@Controller('gateway/wallets')
@UseGuards(RateLimiterGuard)
export class GatewayController {
  private readonly CORE_URL = 'http://localhost:8080/api/wallets';

  @Post()
  async getOrCreateWallet(@Body() body: any) {
    try {
      const response = await axios.post(this.CORE_URL, body);
      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  @Get(':id')
  async getWallet(@Param('id') id: string) {
    try {
      const response = await axios.get(`${this.CORE_URL}/${id}`);
      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  @Post(':id/deduct')
  @UseInterceptors(IdempotencyInterceptor)
  async deduct(
    @Param('id') id: string,
    @Query('method') method: string,
    @Query('latency') latency: number,
    @Query('bypassRedis') bypassRedis: string,
    @Headers('x-idempotency-key') idempotencyKey: string,
    @Body() body: any,
  ) {
    try {
      const response = await axios.post(
        `${this.CORE_URL}/${id}/deduct`,
        {
          amount: body.amount,
          idempotencyKey: idempotencyKey,
        },
        {
          params: { method, latency },
        },
      );
      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  @Post(':id/reset')
  async resetWallet(@Param('id') id: string, @Body() body: any) {
    try {
      const response = await axios.post(`${this.CORE_URL}/${id}/reset`, body);
      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  // Đầu nhận Webhook giả lập của client
  @Post('webhook-receiver')
  receiveWebhook(@Body() body: any) {
    console.log(`[Client Webhook Receiver] Nhận webhook sự kiện thành công:`, body);
    return { status: 'RECEIVED' };
  }

  private handleError(error: any) {
    if (error.response) {
      throw new HttpException(
        error.response.data || 'Error forwarding request to Core',
        error.response.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    throw new HttpException(
      error.message || 'Internal Server Error',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
