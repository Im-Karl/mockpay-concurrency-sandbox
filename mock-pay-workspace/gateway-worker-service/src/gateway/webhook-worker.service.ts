import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import * as amqp from 'amqplib';
import axios from 'axios';

@Injectable()
export class WebhookWorkerService implements OnApplicationBootstrap {
  private readonly WEBHOOK_URL = 'http://localhost:3000/gateway/wallets/webhook-receiver';

  async onApplicationBootstrap() {
    // Delay connection to let RabbitMQ service warm up on boot
    setTimeout(() => this.connectRabbitMQ(), 5000);
  }

  async connectRabbitMQ() {
    try {
      const connection = await amqp.connect('amqp://guest:guest@localhost:5672');
      const channel = await connection.createChannel();
      const queueName = 'payment.success.queue';

      await channel.assertQueue(queueName, { durable: true });
      console.log(`[*] Webhook Worker connected and listening to queue: ${queueName}`);

      channel.consume(queueName, async (msg) => {
        if (msg !== null) {
          const content = msg.content.toString();
          console.log(`[Webhook Worker] Message received from RabbitMQ: ${content}`);

          try {
            const eventPayload = JSON.parse(content);
            
            // Forward event payload to client webhook URL
            await axios.post(this.WEBHOOK_URL, {
              eventId: eventPayload.transactionId || 'mock-id',
              status: 'PROCESSED',
              payload: eventPayload
            });

            channel.ack(msg); // Acknowledge message successfully processed
            console.log(`[Webhook Worker] Webhook dispatched and message ACKed.`);
          } catch (error) {
            console.error('[Webhook Worker] Webhook dispatch failed. NACKing message:', error.message);
            channel.nack(msg, false, false); // NACK message, do not requeue to avoid HOBL
          }
        }
      });
    } catch (err) {
      console.error('[Webhook Worker] RabbitMQ connection failed. Retrying in 10s...', err.message);
      setTimeout(() => this.connectRabbitMQ(), 10000);
    }
  }
}
