import { Injectable, Inject } from '@nestjs/common';
import { StreamConsumer, IStreamMessage, STREAM_PRODUCER, IStreamProducer } from '@nestjs-redisx/streams';
import { AuditEvent, AuditRepo, AlertService } from '../types';

@Injectable()
export class AuditLogger {
  constructor(
    @Inject(STREAM_PRODUCER) private readonly producer: IStreamProducer,
    private readonly auditRepo: AuditRepo,
    private readonly alertService: AlertService,
  ) {}

  async log(event: AuditEvent): Promise<void> {
    await this.producer.publish('audit', {
      action: event.action,
      userId: event.userId,
      resource: event.resource,
      resourceId: event.resourceId,
      changes: event.changes,
      timestamp: new Date(),
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
    });
  }

  // Store in database
  @StreamConsumer({
    stream: 'audit',
    group: 'storage',
  })
  async storeAuditLog(message: IStreamMessage<AuditEvent>): Promise<void> {
    await this.auditRepo.create({
      messageId: message.id,
      ...message.data,
    });

    await message.ack();
  }

  // Alert on sensitive actions
  @StreamConsumer({
    stream: 'audit',
    group: 'alerts',
  })
  async checkAlerts(message: IStreamMessage<AuditEvent>): Promise<void> {
    const event = message.data;

    const sensitiveActions = [
      'USER_DELETED',
      'PERMISSIONS_CHANGED',
      'DATA_EXPORTED',
    ];

    if (sensitiveActions.includes(event.action)) {
      await this.alertService.send({
        title: 'Sensitive Action Performed',
        message: `${event.userId} performed ${event.action}`,
        severity: 'high',
      });
    }

    await message.ack();
  }

  // Query audit log
  async getAuditTrail(resourceId: string): Promise<AuditEvent[]> {
    // Read from stream (for recent events) or database (for historical)
    const events = await this.auditRepo.find({
      where: { resourceId },
      order: { timestamp: 'DESC' },
    });

    return events;
  }
}
