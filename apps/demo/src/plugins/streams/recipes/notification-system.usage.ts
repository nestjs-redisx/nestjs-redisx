import { Injectable, Inject } from '@nestjs/common';
import { StreamConsumer, IStreamMessage, STREAM_PRODUCER, IStreamProducer } from '@nestjs-redisx/streams';
import { Notification, NotificationEvent, EmailService, SmsService, PushService } from '../types';

@Injectable()
export class NotificationSystem {
  constructor(
    @Inject(STREAM_PRODUCER) private readonly producer: IStreamProducer,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
    private readonly pushService: PushService,
  ) {}

  // Publish notification event
  async sendNotification(notification: Notification): Promise<void> {
    await this.producer.publish('notifications', {
      id: notification.id,
      userId: notification.userId,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      channels: notification.channels,  // ['email', 'sms', 'push']
    });
  }

  // Email channel
  @StreamConsumer({
    stream: 'notifications',
    group: 'email-sender',
    concurrency: 10,
  })
  async sendEmail(message: IStreamMessage<NotificationEvent>): Promise<void> {
    if (!message.data.channels.includes('email')) {
      await message.ack();
      return;
    }

    try {
      await this.emailService.send({
        to: await this.getUserEmail(message.data.userId),
        subject: message.data.title,
        body: message.data.message,
      });

      await message.ack();
    } catch (error) {
      await message.reject(error as Error);
    }
  }

  // SMS channel
  @StreamConsumer({
    stream: 'notifications',
    group: 'sms-sender',
    concurrency: 5,
  })
  async sendSMS(message: IStreamMessage<NotificationEvent>): Promise<void> {
    if (!message.data.channels.includes('sms')) {
      await message.ack();
      return;
    }

    try {
      await this.smsService.send({
        to: await this.getUserPhone(message.data.userId),
        message: message.data.message,
      });

      await message.ack();
    } catch (error) {
      await message.reject(error as Error);
    }
  }

  // Push notification channel
  @StreamConsumer({
    stream: 'notifications',
    group: 'push-sender',
    concurrency: 20,
  })
  async sendPush(message: IStreamMessage<NotificationEvent>): Promise<void> {
    if (!message.data.channels.includes('push')) {
      await message.ack();
      return;
    }

    try {
      const tokens = await this.getUserPushTokens(message.data.userId);

      await this.pushService.send({
        tokens,
        title: message.data.title,
        body: message.data.message,
      });

      await message.ack();
    } catch (error) {
      await message.reject(error as Error);
    }
  }

  private async getUserEmail(userId: string): Promise<string> {
    return `${userId}@example.com`;
  }

  private async getUserPhone(userId: string): Promise<string> {
    return '+1234567890';
  }

  private async getUserPushTokens(userId: string): Promise<string[]> {
    return ['token-1', 'token-2'];
  }
}
